import { randomUUID } from "node:crypto"
import { and, count, eq, inArray, sql } from "drizzle-orm"
import { z } from "zod"
import { createServerFn } from "@tanstack/react-start"
import { readCatalogue } from "./services/catalogue"
import { getCataloguePreview as readCataloguePreview } from "./services/catalogue-preview"
import { enqueueIngest } from "./services/ingest-queue"
import { freeFolderName } from "./services/feed-write"
import { resolveWorkspaceId } from "./services/context"
import { feedInWorkspace } from "./services/tenancy"
import type { PreviewFeed } from "./services/catalogue-preview"
import type { CatalogueCategoryView } from "./services/catalogue"
import { workspaceWriteMiddleware } from "@/server/entitlements/browser-write"
import { db } from "@/db/index"
import {
  articles,
  catalogueCollections,
  catalogueFeeds,
  feeds,
  folders,
} from "@/db/schema"
import { normalizeFeedUrl } from "@/lib/validation"
import { DEMO_MODE } from "@/lib/demo"
import { withNoRssSourceCapacity } from "@/server/entitlements/enforce"

const DEMO_LOCKED_MSG = "This feature is locked in demo mode"

// ─────────────────────────────────────────────
// READ
// ─────────────────────────────────────────────

export const getCatalogue = createServerFn({ method: "GET" }).handler(
  async (): Promise<Array<CatalogueCategoryView>> => {
    // Demo mode builds its schema lazily and out of band, so the catalogue
    // tables have to exist before the first read, the same way every other
    // demo query depends on them.
    if (DEMO_MODE) {
      const { ensureDemoSchema } = await import("@/server/demo-seeder")
      await ensureDemoSchema()
    }
    return await readCatalogue()
  }
)

/**
 * Recent articles behind one catalogue card, for the preview dialog.
 *
 * POST despite being a read: it can write the shared article cache, and a GET
 * server fn is fair game for the router to prefetch.
 */
export const getCataloguePreview = createServerFn({ method: "POST" })
  .validator(
    z.object({
      kind: z.enum(["collection", "feed"]),
      slug: z.string().min(1).max(64),
    })
  )
  .handler(async ({ data }): Promise<{ feeds: Array<PreviewFeed> }> => {
    if (DEMO_MODE) {
      const { ensureDemoSchema } = await import("@/server/demo-seeder")
      await ensureDemoSchema()
    }
    return await readCataloguePreview(data.kind, data.slug)
  })

// ─────────────────────────────────────────────
// IMPORT
// ─────────────────────────────────────────────

export type ImportResult =
  | {
      status: "ok"
      folderId: string | null
      feedIds: Array<string>
      added: number
      skipped: number
    }
  | { status: "already_added" }
  | { status: "error"; message: string }

/**
 * Adds a catalogue collection or feed to the caller's workspace.
 *
 * Rows are created immediately from URLs that were resolved and validated at
 * curation time, so nothing here touches the network — the whole call is four
 * round trips. Articles are fetched afterwards by the ingest queue, which the
 * response does not wait for.
 *
 * `addRssFeed` is deliberately not reused: it fetches inline and deletes the
 * feed row again if that fetch fails. Correct when a user typed a URL and a
 * silent dead feed would be a bug; wrong for a catalogue entry that CI has
 * already proven resolves, where a transient failure should leave the row and
 * retry later.
 */
export const importCatalogueItem = createServerFn({ method: "POST" })
  .middleware([workspaceWriteMiddleware])
  .validator(
    z.object({
      kind: z.enum(["collection", "feed"]),
      slug: z.string().min(1),
    })
  )
  .handler(async ({ data }): Promise<ImportResult> => {
    if (DEMO_MODE) return { status: "error", message: DEMO_LOCKED_MSG }

    const workspaceId = await resolveWorkspaceId()
    if (!workspaceId) return { status: "error", message: "Not signed in" }

    // Read the entry from the database, never from the request. A client that
    // could name its own feed URLs would turn this into an open write endpoint.
    const entries =
      data.kind === "collection"
        ? await db
            .select()
            .from(catalogueFeeds)
            .where(eq(catalogueFeeds.collectionSlug, data.slug))
        : await db
            .select()
            .from(catalogueFeeds)
            .where(eq(catalogueFeeds.slug, data.slug))

    if (
      entries.length === 0 ||
      entries.some((e) => e.retiredAt || e.status === "dead")
    )
      return { status: "error", message: "Not found" }

    // Dedupe BEFORE creating anything. Reversed, a second click on a collection
    // whose feeds are all present would leave behind an empty "OpenAI (2)".
    const wanted = entries.map((e) => e.feedUrl)
    const existing = await db
      .select({ url: feeds.url })
      .from(feeds)
      .where(and(feedInWorkspace(workspaceId), inArray(feeds.url, wanted)))

    const have = new Set(existing.map((f) => normalizeFeedUrl(f.url) ?? f.url))
    const fresh = entries.filter(
      (e) => !have.has(normalizeFeedUrl(e.feedUrl) ?? e.feedUrl)
    )

    if (fresh.length === 0) return { status: "already_added" }
    const pageCount = fresh.filter((e) => e.sourceKind === "page").length
    let folderId: string | null = null
    const rows = await withNoRssSourceCapacity(
      workspaceId,
      pageCount,
      async (tx) => {
        if (data.kind === "collection") {
          const [collection] = await tx
            .select()
            .from(catalogueCollections)
            .where(eq(catalogueCollections.slug, data.slug))
            .limit(1)
          if (!collection) throw new Error("Collection not found")

          folderId = randomUUID()
          await tx.insert(folders).values({
            id: folderId,
            name: await freeFolderName(workspaceId, collection.name),
            workspaceId,
            createdAt: new Date().toISOString(),
          })
        }

        const created = fresh.map((e) => ({
          id: randomUUID(),
          name: e.name,
          url: e.feedUrl,
          kind: e.sourceKind === "page" ? "page" : "rss",
          folderId,
          workspaceId,
          includeKeywords: "[]",
          excludeKeywords: "[]",
        }))
        await tx.insert(feeds).values(created)
        return created
      }
    )

    // Global counter, not per-user: there is no catalogue_imports table and no
    // reason to record who added what.
    const bump = { importCount: sql`${catalogueFeeds.importCount} + 1` }
    await db
      .update(catalogueFeeds)
      .set(bump)
      .where(
        inArray(
          catalogueFeeds.slug,
          fresh.map((e) => e.slug)
        )
      )
    if (data.kind === "collection") {
      await db
        .update(catalogueCollections)
        .set({ importCount: sql`${catalogueCollections.importCount} + 1` })
        .where(eq(catalogueCollections.slug, data.slug))
    }

    // Detached on purpose: the response returns now, the fetching continues in
    // this process. Nothing awaits this.
    enqueueIngest(rows.map((r) => ({ feedId: r.id, url: r.url, kind: r.kind })))

    return {
      status: "ok",
      folderId,
      feedIds: rows.map((r) => r.id),
      added: rows.length,
      skipped: entries.length - fresh.length,
    }
  })

/**
 * How far along a just-started import is.
 *
 * Derived from the feed rows rather than the queue's memory: `recordFeedHealth`
 * already stamps `lastFetchedAt` / `lastErrorAt` on every attempt, so this is
 * correct across replicas and after a page reload, which an in-memory job map
 * would not be.
 */
export const getImportStatus = createServerFn({ method: "POST" })
  .validator(z.object({ feedIds: z.array(z.string()).min(1).max(50) }))
  .handler(
    async ({
      data,
    }): Promise<{ done: number; total: number; articles: number }> => {
      const workspaceId = await resolveWorkspaceId()

      const rows = await db
        .select({
          id: feeds.id,
          lastFetchedAt: feeds.lastFetchedAt,
          lastErrorAt: feeds.lastErrorAt,
        })
        .from(feeds)
        .where(
          and(feedInWorkspace(workspaceId), inArray(feeds.id, data.feedIds))
        )

      const [articleCount] = await db
        .select({ value: count() })
        .from(articles)
        .where(
          inArray(
            articles.feedId,
            rows.map((r) => r.id)
          )
        )

      return {
        done: rows.filter((r) => r.lastFetchedAt || r.lastErrorAt).length,
        total: rows.length,
        articles: Number(articleCount?.value ?? 0),
      }
    }
  )
