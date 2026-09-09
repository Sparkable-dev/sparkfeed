import { randomUUID } from "node:crypto"
import { and, count, eq, inArray, isNull } from "drizzle-orm"
import { z } from "zod"
import { createServerFn } from "@tanstack/react-start"
import { fetchAndInsertArticles } from "./utils/fetch-articles"
import { ingestSource } from "./utils/fetch-page-articles"
import { safeFetch, safeFetchText } from "./utils/fetch"
import {
  checkCanEmbed,
  extractReadable,
  sanitizeArticleHtml,
} from "./utils/extract"
import { resolveFeed } from "./utils/detectRSS"
import { discoverMoreFeeds } from "./utils/discover"
import { feedError, toFeedError } from "./utils/feed-errors"
import { resolveWorkspaceContext, resolveWorkspaceId } from "./services/context"
import {
  NOT_FOUND_MSG,
  assertOwnsFeed,
  assertOwnsFolder,
} from "./services/ownership"
import { deleteFolderTree } from "./services/folder-delete"
import {
  cleanFolderName,
  existingFeedKeys,
  freeFolderName,
  insertFeedRows,
  resolveDestination,
} from "./services/feed-write"
import {
  recallResolved,
  rememberResolved,
} from "./services/feed-resolution-cache"
import { resolveFeedBatch as resolveBatch } from "./services/feed-resolve-batch"
import {
  articleInWorkspace,
  feedInWorkspace,
  folderInWorkspace,
} from "./services/tenancy"
import { FEED_ORDER, FOLDER_ORDER } from "./services/ordering"
import { emptySignals } from "./utils/feed-signals"
import { ingestFeeds } from "./services/ingest-queue"
import { readFavoriteIds, writeFavorites } from "./services/favorites"
import { readNavigationCounts } from "./services/navigation"
import type { FeedError } from "./utils/feed-errors"
import type { DiscoveredFeed } from "./utils/discover"
import type { ResolvedFeed } from "./utils/detectRSS"
import type { FeedSignals } from "./utils/feed-signals"
import type { ArticleRow } from "@/components/ArticleGrid"
import { workspaceWriteMiddleware } from "@/server/entitlements/browser-write"
import { articles, feedShares, feeds, folderShares, folders } from "@/db/schema"
import { db } from "@/db/index"
import { feedUrlKey, feedUrlSchema } from "@/lib/validation"
import { MAX_BATCH_URLS, MAX_BULK_FEEDS } from "@/lib/bulk-urls"
import { feedNeedsRefresh } from "@/lib/feed-freshness"
import { DEMO_MODE } from "@/lib/demo"
import { assertNoRssSourceCapacity } from "@/server/entitlements/enforce"

function previewDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

const DEMO_LOCKED_MSG = "This feature is locked in demo mode"

// ─────────────────────────────────────────────
// FETCH ALL DATA
// ─────────────────────────────────────────────

export const getAllData = createServerFn({ method: "GET" })
  .validator(z.object({ workspaceId: z.string(), userId: z.string() }).optional())
  .handler(async ({ data: requestedScope }) => {
    const context = await resolveWorkspaceContext()
    const { workspaceId, demo } = context
    if (requestedScope && (requestedScope.workspaceId !== workspaceId || requestedScope.userId !== context.userId)) throw new Error("Workspace changed. Reload this page.")

    if (demo) {
      // Ensure schema exists before any query — handles fresh/wiped demo db.
      const { ensureDemoSchema } = await import("@/server/demo-seeder")
      await ensureDemoSchema()
    }

    const workspaceFilter = folderInWorkspace(workspaceId)
    const feedWorkspaceFilter = feedInWorkspace(workspaceId)
    const fetchAll = () =>
      Promise.all([
        db
          .select({
            id: folders.id,
            name: folders.name,
            workspaceId: folders.workspaceId,
            createdAt: folders.createdAt,
            isShared: folderShares.isShared,
            password: folderShares.password,
          })
          .from(folders)
          .leftJoin(folderShares, eq(folders.id, folderShares.folderId))
          .where(workspaceFilter)
          .orderBy(...FOLDER_ORDER),
        // Joined the same way folders are, above. Without it `feeds` came back with
        // no share columns at all, so every feed row in the sidebar reported itself
        // as private no matter what `feed_shares` said.
        db
          .select({
            id: feeds.id,
            name: feeds.name,
            url: feeds.url,
            folderId: feeds.folderId,
            workspaceId: feeds.workspaceId,
            // Marks a watched page in the sidebar and on /sources. A page-read source
            // is a plausible-looking feed that is only as good as someone else's
            // markup, and saying so is the difference between "this is quiet" and
            // "this stopped working".
            kind: feeds.kind,
            includeKeywords: feeds.includeKeywords,
            excludeKeywords: feeds.excludeKeywords,
            createdAt: feeds.createdAt,
            // Drives the top bar's "Updated 4m ago". Cheap here — one more column on
            // a query already running — versus a second round trip on every page.
            lastFetchedAt: feeds.lastFetchedAt,
            lastErrorAt: feeds.lastErrorAt,
            entitlementPausedAt: feeds.entitlementPausedAt,
            isShared: feedShares.isShared,
            password: feedShares.password,
          })
          .from(feeds)
          .leftJoin(feedShares, eq(feeds.id, feedShares.feedId))
          .where(feedWorkspaceFilter)
          .orderBy(...FEED_ORDER),
      ])

    // Destructured into fresh bindings because the demo branch below reassigns
    // the feed lists after seeding, while the folder rows are only ever mapped.
    const [foldersRaw, initialFeeds] = await fetchAll()
    let allFeeds = initialFeeds

    let allFolders = foldersRaw.map((f) => ({
      id: f.id,
      name: f.name,
      workspaceId: f.workspaceId,
      createdAt: f.createdAt,
      isShared: !!f.isShared,
      hasPassword: !!f.password,
    }))

    if (allFolders.length === 0) {
      if (DEMO_MODE) {
        // Seed demo workspace on first load
        const { seedDemoData } = await import("@/server/demo-seeder")
        await seedDemoData()
        const [reseeded, reseedFeeds] = await fetchAll()
        allFolders = reseeded.map((f) => ({
          id: f.id,
          name: f.name,
          workspaceId: f.workspaceId,
          createdAt: f.createdAt,
          isShared: !!f.isShared,
          hasPassword: !!f.password,
        }))
        allFeeds = reseedFeeds
      }
    }

    // Collapse the joined share row to the two booleans the client needs. The
    // password hash must not leave the server, so it is dropped here rather than
    // relied on being ignored downstream.
    const allFeedsWithShare = allFeeds.map((f) => {
      const { password, ...rest } = f
      return { ...rest, isShared: !!f.isShared, hasPassword: !!password }
    })

    // Navigation needs aggregates and IDs, never an arbitrary article sample.
    const [counts, favorites] = await Promise.all([
      readNavigationCounts(workspaceId), readFavoriteIds(context),
    ])
    return {
      folders: allFolders,
      feeds: allFeedsWithShare,
      articles: [] as Array<ArticleRow>,
      degraded: false,
      counts,
      favorites,
    }
  }
)

// ─────────────────────────────────────────────
// CREATE FOLDER
// ─────────────────────────────────────────────

export const createFolder = createServerFn({ method: "POST" }).middleware([workspaceWriteMiddleware])
  .validator((d: any) => z.object({ name: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    if (DEMO_MODE) throw new Error(DEMO_LOCKED_MSG)
    const workspaceId = await resolveWorkspaceId()

    // Cleaned and uniquified through the same helpers the Add dialog uses.
    // This used to write `data.name` straight through: no trim, no cap, so a
    // pasted paragraph became a folder name and a name of spaces became a
    // folder you could not see in the sidebar.
    const name = cleanFolderName(data.name)
    if (!name) throw new Error("A folder needs a name.")

    const id = randomUUID()
    const free = await freeFolderName(workspaceId, name)
    await db.insert(folders).values({ id, name: free, workspaceId })
    return { id, name: free, workspaceId }
  })

// ─────────────────────────────────────────────
// CREATE FEED + FETCH RSS ARTICLES
// ─────────────────────────────────────────────

type CreatedFeed = {
  id: string
  name: string
  url: string
  folderId: string | null
  workspaceId: string | null
}

export type CreateFeedResult =
  /** `partial` means some articles were rejected but the feed is usable. */
  | {
      status: "rss"
      feed: CreatedFeed
      articleCount: number
      partial: boolean
      type: "rss"
    }
  | {
      status: "scraped"
      feed: CreatedFeed
      articleCount: number
      type: "scraped"
    }
  | { status: "error"; error: FeedError }

/**
 * `assertOwnsFeed` / `assertOwnsFolder` / `NOT_FOUND_MSG` moved to
 * `services/ownership.ts` so the share API routes can use the same checks.
 */

/** One feed offered to the user in the Add Feed dialog. */
export type FeedCandidate = {
  url: string
  title: string | null
  itemCount: number
  sampleTitles: Array<string>
  /** Section slug for a section feed, e.g. "tech". Null for the site's main feed. */
  section: string | null
  /**
   * `primary` is the site's own feed, `section` one of its others, and `page` a
   * listing we would read as a feed because there is no feed at all.
   */
  kind: "primary" | "section" | "page"
  alreadyAdded: boolean
  /** Stable identity, so the deep pass does not re-offer a feed already listed. */
  identity: string
  /**
   * Cadence, staleness, comments-feed detection and the rest. See
   * `utils/feed-signals.ts` — this is what the dialog draws under each name,
   * and it costs nothing beyond the parse that already happened.
   */
  signals: FeedSignals
}

export type PreviewFeedResult =
  | {
      status: "ok"
      origin: string
      siteName: string
      feeds: Array<FeedCandidate>
    }
  | { status: "error"; error: FeedError }

export type DiscoverFeedsResult =
  | { status: "ok"; feeds: Array<FeedCandidate> }
  | { status: "error"; error: FeedError }

export type FindPagesResult =
  | { status: "ok"; pages: Array<FeedCandidate> }
  | { status: "error"; error: FeedError }

/** One row of the bulk tab: what was typed, and what came back. */
export type BatchFeedResult = {
  input: string
  feed: FeedCandidate | null
  error: FeedError | null
}

export type ResolveFeedBatchResult =
  | { status: "ok"; results: Array<BatchFeedResult> }
  | { status: "error"; error: FeedError }

/** Human label for a site, used to pre-fill the folder name. */
function siteNameFor(origin: string, primaryTitle: string | null): string {
  if (primaryTitle) return primaryTitle
  try {
    return new URL(origin).hostname.replace(/^www\./, "")
  } catch {
    return origin
  }
}

/**
 * Shapes a discovered feed for the dialog.
 *
 * Takes the workspace's existing URLs as a set rather than looking each one up:
 * this used to issue a SELECT per candidate, so drawing "already added" beside
 * twelve results cost twelve queries.
 *
 * `feed.signals.identity` rather than `feedIdentity(feed)`, and that is not a
 * style choice. This module is part of the *client* build with its handler
 * bodies stripped, so any plain function it calls at module level keeps that
 * function's whole module alive in the browser bundle — and `utils/discover`
 * constructs an rss-parser at import time, which drags in `utils/fetch` and its
 * `node:net` import. The build fails with `"isIP" is not exported by
 * "__vite-browser-external"`. Same trap as the note in `sources-write.ts`.
 */
function toCandidate(
  existing: Set<string>,
  feed: DiscoveredFeed
): FeedCandidate {
  return {
    url: feed.url,
    title: feed.title,
    itemCount: feed.itemCount,
    sampleTitles: feed.sampleTitles,
    section: feed.section,
    kind: feed.kind,
    alreadyAdded: existing.has(feedUrlKey(feed.url)),
    identity: feed.signals.identity,
    signals: feed.signals,
  }
}

/**
 * Fast pass. Resolves the typed URL to the site's main feed and returns it
 * immediately, so the dialog has something to show in a couple of seconds.
 *
 * An empty `feeds` list is not an error: the deep pass runs next and may still
 * find something. Only a bad or unreachable address is reported as an error.
 */
export const previewFeed = createServerFn({ method: "POST" })
  .validator((d: any) => z.object({ url: feedUrlSchema }).parse(d))
  .handler(async ({ data }): Promise<PreviewFeedResult> => {
    if (DEMO_MODE) return { status: "error", error: feedError("demo_locked") }

    const workspaceId = await resolveWorkspaceId()
    const origin = new URL(data.url).origin

    let resolved: ResolvedFeed | null
    try {
      resolved = await resolveFeed(data.url)
    } catch (err) {
      return { status: "error", error: toFeedError(err) }
    }

    // Named for what it holds rather than `feeds`, which is the table imported
    // at the top of this module and was being shadowed here.
    const existing = await existingFeedKeys(workspaceId)
    const candidates = resolved
      ? [toCandidate(existing, { ...resolved, kind: "primary", section: null })]
      : []

    // What we proved, so the submit does not have to prove it again.
    if (resolved)
      rememberResolved(workspaceId, [
        { url: resolved.url, title: resolved.title },
      ])

    return {
      status: "ok",
      origin,
      siteName: siteNameFor(origin, resolved?.title ?? null),
      feeds: candidates,
    }
  })

/**
 * Deep pass. Looks for the site's other feeds (news vs blog vs engineering)
 * and returns only the ones not already listed.
 *
 * Split from previewFeed on purpose: it costs a sitemap read plus a bounded set
 * of probes, and the user should not wait on that to add the main feed.
 */
export const discoverFeeds = createServerFn({ method: "POST" })
  .validator((d: any) =>
    z
      .object({
        origin: feedUrlSchema,
        anchorUrl: z.string().nullable().optional(),
        known: z.array(z.string()).max(50).optional(),
      })
      .parse(d)
  )
  .handler(async ({ data }): Promise<DiscoverFeedsResult> => {
    if (DEMO_MODE) return { status: "error", error: feedError("demo_locked") }

    const workspaceId = await resolveWorkspaceId()

    try {
      const found = await discoverMoreFeeds({
        origin: data.origin,
        anchorUrl: data.anchorUrl ?? null,
        known: data.known ?? [],
      })
      const existing = await existingFeedKeys(workspaceId)
      rememberResolved(
        workspaceId,
        found.map((f) => ({ url: f.url, title: f.title }))
      )
      return { status: "ok", feeds: found.map((f) => toCandidate(existing, f)) }
    } catch (err) {
      return { status: "error", error: toFeedError(err) }
    }
  })

/**
 * Pages on a site that could be read as a feed, when it has none.
 *
 * Only called once the feed search has come back empty — that ordering is the
 * product decision, not an optimisation. A real feed is always better than
 * parsing someone's HTML, so we look for one first and offer this second.
 */
export const findPages = createServerFn({ method: "POST" })
  .validator((d: any) => z.object({ url: feedUrlSchema }).parse(d))
  .handler(async ({ data }): Promise<FindPagesResult> => {
    if (DEMO_MODE) return { status: "error", error: feedError("demo_locked") }

    const workspaceId = await resolveWorkspaceId()

    try {
      const { discoverReadablePages } =
        await import("./services/page-discovery")
      const pages = await discoverReadablePages(data.url)
      const existing = await existingFeedKeys(workspaceId)

      rememberResolved(
        workspaceId,
        pages.map((p) => ({
          url: p.url,
          title: p.title,
          kind: "page" as const,
        }))
      )

      return {
        status: "ok",
        pages: pages.map((page) => ({
          url: page.url,
          title: page.title,
          itemCount: page.itemCount,
          sampleTitles: page.sampleTitles,
          section: page.section,
          kind: "page" as const,
          alreadyAdded: existing.has(feedUrlKey(page.url)),
          identity: `page::${feedUrlKey(page.url)}`,
          /*
            A listing page has no cadence and no dates to speak of — it is a
            wall of links. `emptySignals` says exactly that rather than
            inventing a freshness, and the row falls back to describing the
            page instead.
          */
          signals: emptySignals(page.url),
        })),
      }
    } catch (err) {
      return { status: "error", error: toFeedError(err) }
    }
  })

/**
 * The bulk tab's check step: several pasted URLs at once.
 *
 * Small batches on purpose. The client sends them a few at a time and appends
 * results as they land, so each request stays short and the progress bar comes
 * for free. A failure is a row rather than an exception — one dead address out
 * of fifteen must not lose the other fourteen.
 */
export const resolveFeedBatch = createServerFn({ method: "POST" })
  .validator((d: any) =>
    z
      .object({ urls: z.array(feedUrlSchema).min(1).max(MAX_BATCH_URLS) })
      .parse(d)
  )
  .handler(async ({ data }): Promise<ResolveFeedBatchResult> => {
    if (DEMO_MODE) return { status: "error", error: feedError("demo_locked") }

    const workspaceId = await resolveWorkspaceId()
    const existing = await existingFeedKeys(workspaceId)

    const resolved = await resolveBatch(data.urls)

    rememberResolved(
      workspaceId,
      resolved
        .filter((r) => r.feed)
        .map((r) => ({ url: r.feed!.url, title: r.feed!.title }))
    )

    return {
      status: "ok",
      results: resolved.map((r) => ({
        input: r.input,
        error: r.error,
        feed: r.feed
          ? toCandidate(existing, { ...r.feed, kind: "primary", section: null })
          : null,
      })),
    }
  })

/**
 * Inserts one RSS feed and pulls its articles before returning.
 *
 * The single-feed path, and deliberately not what `createFeeds` does. The
 * difference is what the caller can say afterwards: someone who typed one URL
 * and pressed Add is waiting for an answer, and "added, with 20 articles" in
 * two seconds is worth the wait. Someone who ticked fifteen is not waiting for
 * fifteen sequential fetches, so that path inserts and lets the queue catch up.
 *
 * The rollback rule stays here for the same reason: this path can be reached
 * with a URL nothing has verified, so a feed whose articles all fail to store
 * is deleted again rather than left as a subscription that shows nothing.
 */
async function addRssFeed(opts: {
  workspaceId: string | null
  url: string
  name: string
  folderId: string | null
  includeKeywords?: Array<string>
  excludeKeywords?: Array<string>
}): Promise<CreateFeedResult> {
  const { workspaceId, url, name, folderId } = opts

  const existing = await existingFeedKeys(workspaceId)
  if (existing.has(feedUrlKey(url)))
    return { status: "error", error: feedError("duplicate") }

  const id = randomUUID()
  await db.insert(feeds).values({
    id,
    name,
    url,
    folderId,
    workspaceId,
    includeKeywords: JSON.stringify(opts.includeKeywords ?? []),
    excludeKeywords: JSON.stringify(opts.excludeKeywords ?? []),
  })
  const feed: CreatedFeed = { id, name, url, folderId, workspaceId }

  try {
    const result = await fetchAndInsertArticles(id, url)

    // Every row was rejected. The feed parsed, so this is our problem, not the
    // user's: report it rather than claiming success with zero articles, which
    // is how a broken schema stayed invisible for weeks.
    if (result.inserted === 0 && result.failed > 0) {
      console.error(
        `[addRssFeed] All ${result.failed} article inserts failed for ${url}, rolling back feed.`
      )
      await db
        .delete(feeds)
        .where(eq(feeds.id, id))
        .catch(() => {})
      return { status: "error", error: feedError("internal") }
    }

    return {
      status: "rss",
      feed,
      articleCount: result.inserted,
      partial: result.failed > 0,
      type: "rss",
    }
  } catch (err) {
    console.error("[addRssFeed] Article ingest failed, rolling back feed:", err)
    await db
      .delete(feeds)
      .where(eq(feeds.id, id))
      .catch(() => {})
    return { status: "error", error: toFeedError(err) }
  }
}

/**
 * Adds a site with no feed, read from its listing page.
 *
 * The same shape as `addRssFeed` and, importantly, the same table. A watched
 * page used to be written to `scraped_feeds` — its own id space, its own
 * article table, joined by URL string — which is why nothing in the app could
 * render one. Here it is a `feeds` row with `kind: 'page'`, so the sidebar, the
 * grid, search, the reader and every AI tool treat it as what it is: a source.
 *
 * Ingest is inline rather than queued because this is the moment the user finds
 * out whether reading the page works at all. A rollback on failure is right for
 * the same reason: an empty watched page is not a source, it is a mistake.
 */
async function addPageFeed(opts: {
  workspaceId: string | null
  url: string
  name: string
  folderId: string | null
}): Promise<CreateFeedResult> {
  const { workspaceId, url, name, folderId } = opts

  const existing = await existingFeedKeys(workspaceId)
  if (existing.has(feedUrlKey(url)))
    return { status: "error", error: feedError("duplicate") }

  if (workspaceId) await assertNoRssSourceCapacity(workspaceId, 1)

  const id = randomUUID()
  await db.insert(feeds).values({
    id,
    name,
    url,
    kind: "page",
    folderId,
    workspaceId,
    includeKeywords: JSON.stringify([]),
    excludeKeywords: JSON.stringify([]),
  })

  try {
    const result = await ingestSource(id, url, "page")
    if (result.inserted === 0) {
      await db
        .delete(feeds)
        .where(eq(feeds.id, id))
        .catch(() => {})
      return { status: "error", error: feedError("no_items") }
    }
    return {
      status: "scraped",
      feed: { id, name, url, folderId, workspaceId },
      articleCount: result.inserted,
      type: "scraped",
    }
  } catch (err) {
    console.error("[addPageFeed] Page ingest failed, rolling back source:", err)
    await db
      .delete(feeds)
      .where(eq(feeds.id, id))
      .catch(() => {})
    return { status: "error", error: toFeedError(err) }
  }
}

export type CreateFeedsResult =
  | {
      status: "ok"
      folderId: string | null
      added: Array<{ id: string; url: string; name: string }>
      /** Already in the workspace. Not a failure — just nothing to do. */
      skipped: Array<{ url: string; name: string }>
      failed: Array<{ url: string; name: string; message: string }>
    }
  | { status: "error"; error: FeedError }

/**
 * Adds a batch of already-checked feeds, optionally into a folder it creates.
 *
 * Three things this stopped doing, all for the same reason — twenty feeds used
 * to take one to three minutes:
 *
 *   • it no longer fetches articles inline. Every URL here was resolved and
 *     parsed during the check step, so a second fetch proves nothing; the queue
 *     picks them up after the response goes out.
 *   • it no longer loops. One insert, whatever the count.
 *   • it no longer creates a folder speculatively and deletes it again when
 *     nothing lands in it. The destination is resolved once there is something
 *     to put in it.
 *
 * What it will not do is take the client's word for a URL. Anything this
 * workspace has not actually resolved recently is resolved now — see
 * `feed-resolution-cache.ts`.
 */
export const createFeeds = createServerFn({ method: "POST" }).middleware([workspaceWriteMiddleware])
  .validator((d: any) =>
    z
      .object({
        feeds: z
          .array(
            z.object({
              url: feedUrlSchema,
              name: z.string().min(1),
              /** `page` for a site with no feed, read from its listing. */
              kind: z.enum(["rss", "page"]).optional().default("rss"),
            })
          )
          .min(1)
          .max(MAX_BULK_FEEDS),
        destination: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("none") }),
          z.object({
            kind: z.literal("existing"),
            folderId: z.string().min(1),
          }),
          z.object({ kind: z.literal("new"), name: z.string().min(1) }),
        ]),
      })
      .parse(d)
  )
  .handler(async ({ data }): Promise<CreateFeedsResult> => {
    if (DEMO_MODE) return { status: "error", error: feedError("demo_locked") }

    const workspaceId = await resolveWorkspaceId()

    const failed: Array<{ url: string; name: string; message: string }> = []
    const skipped: Array<{ url: string; name: string }> = []
    const ready: Array<{ url: string; name: string; kind: string }> = []

    /*
      Anything already proven stays as it is; the rest is checked now, in
      parallel. In the normal flow — check, tick, add — every URL is a cache hit
      and this makes no requests at all.

      A page is verified as a page and a feed as a feed. Sending a listing URL
      through the feed resolver would report `not_a_feed`, which is true and
      unhelpful: the point of a watched page is that it is not one.
    */
    const unknown = data.feeds.filter(
      (f) => !recallResolved(workspaceId, f.url)
    )
    const proven = new Map<string, string>()

    const unknownFeeds = unknown.filter((f) => f.kind !== "page")
    if (unknownFeeds.length > 0) {
      const results = await resolveBatch(unknownFeeds.map((f) => f.url))
      for (let i = 0; i < results.length; i++) {
        const result = results[i]
        if (result.feed) proven.set(unknownFeeds[i].url, result.feed.url)
        else {
          failed.push({
            ...unknownFeeds[i],
            message: (result.error ?? feedError("not_a_feed")).message,
          })
        }
      }
    }

    for (const item of unknown.filter((f) => f.kind === "page")) {
      try {
        const { res, text } = await safeFetchText(item.url, {
          timeoutMs: 10_000,
        })
        const { looksLikeListing } = await import("./utils/page-feed")
        if (res.ok && looksLikeListing(text, item.url))
          proven.set(item.url, item.url)
        else failed.push({ ...item, message: feedError("not_a_feed").message })
      } catch (err) {
        failed.push({ ...item, message: toFeedError(err).message })
      }
    }

    const existing = await existingFeedKeys(workspaceId)
    // Within the batch too: the same feed reached at /feed and /rss.xml must
    // not become two subscriptions.
    const seen = new Set<string>()

    for (const item of data.feeds) {
      const url =
        recallResolved(workspaceId, item.url)?.url ?? proven.get(item.url)
      if (!url) continue // already reported in `failed` above

      const key = feedUrlKey(url)
      if (existing.has(key) || seen.has(key)) {
        skipped.push({ url, name: item.name })
        continue
      }
      seen.add(key)
      ready.push({ url, name: item.name, kind: item.kind })
    }

    if (ready.length === 0) {
      return { status: "ok", folderId: null, added: [], skipped, failed }
    }

    let folderId: string | null
    try {
      folderId = await resolveDestination(workspaceId, data.destination)
    } catch {
      // The only thing `resolveDestination` throws is an ownership failure.
      return { status: "error", error: feedError("not_found") }
    }

    const added = await insertFeedRows(workspaceId, folderId, ready)
    return { status: "ok", folderId, added, skipped, failed }
  })

export const createFeed = createServerFn({ method: "POST" }).middleware([workspaceWriteMiddleware])
  .validator((d: any) =>
    z
      .object({
        name: z.string().min(1),
        url: feedUrlSchema,
        folderId: z.string().nullable(),
        includeKeywords: z.array(z.string()),
        excludeKeywords: z.array(z.string()),
        /** Set when the user explicitly chose to add a site with no feed. */
        allowScrape: z.boolean().optional().default(false),
      })
      .parse(d)
  )
  .handler(async ({ data }): Promise<CreateFeedResult> => {
    if (DEMO_MODE) return { status: "error", error: feedError("demo_locked") }

    const workspaceId = await resolveWorkspaceId()

    /*
      Checked before the outbound fetch, not after. `createFeeds` (the bulk
      sibling) has always called `assertOwnsFolder`; this one wrote
      `data.folderId` straight through, so a feed could be created directly
      into another workspace's folder. Doing it first also means an unowned
      destination cannot make the server go and resolve a URL on its behalf.
    */
    if (data.folderId) await assertOwnsFolder(data.folderId, workspaceId)

    let resolved: ResolvedFeed | null
    try {
      resolved = await resolveFeed(data.url)
    } catch (err) {
      return { status: "error", error: toFeedError(err) }
    }

    if (resolved) {
      return addRssFeed({
        workspaceId,
        url: resolved.url,
        name: data.name,
        folderId: data.folderId,
        includeKeywords: data.includeKeywords,
        excludeKeywords: data.excludeKeywords,
      })
    }

    // No feed found. Only fall back to reading the page when the user asked for
    // it; silently turning a mistyped feed URL into a watched page is how people
    // ended up with sources they did not recognise.
    if (!data.allowScrape) {
      return { status: "error", error: feedError("not_a_feed") }
    }

    return addPageFeed({
      workspaceId,
      url: data.url,
      name: data.name,
      folderId: data.folderId,
    })
  })

// ─────────────────────────────────────────────
// REFRESH ALL FEEDS
// ─────────────────────────────────────────────

export const refreshAllFeeds = createServerFn({ method: "POST" }).middleware([workspaceWriteMiddleware]).handler(
  async () => {
    const workspaceId = await resolveWorkspaceId()

    const allFeeds = await db
      .select()
      .from(feeds)
      .where(
        and(feedInWorkspace(workspaceId), isNull(feeds.entitlementPausedAt))
      )
    return ingestFeeds(allFeeds.map((f) => ({ feedId: f.id, url: f.url, kind: f.kind })))
  }
)

/** Refresh is POST work, triggered after mount rather than by a loader or preload. */
export const refreshStaleFeeds = createServerFn({ method: "POST" })
  .middleware([workspaceWriteMiddleware])
  .validator(z.object({ workspaceId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { workspaceId, demo } = await resolveWorkspaceContext()
    // A tab opened before a workspace switch must not refresh the new workspace.
    if (demo || !workspaceId || workspaceId !== data.workspaceId) {
      return { inserted: 0, failed: 0, refreshed: 0 }
    }
    const candidates = await db.select().from(feeds).where(
      and(feedInWorkspace(workspaceId), isNull(feeds.entitlementPausedAt))
    )
    const now = Date.now()
    return ingestFeeds(candidates.filter((feed) => feedNeedsRefresh(feed, now))
      .map((feed) => ({ feedId: feed.id, url: feed.url, kind: feed.kind })))
  })

// ─────────────────────────────────────────────
// REFRESH SINGLE FEED
// ─────────────────────────────────────────────

/**
 * Retries one source, for the home page's "this feed is not fetching" line.
 *
 * A whole-workspace refresh would work, but it fetches every feed to fix one
 * and takes as long as the slowest of them — which is the wrong shape for a
 * button sitting next to a single broken row.
 *
 * `fetchAndInsertArticles` clears `last_error` on success and rewrites it on
 * failure, so the caller does not need to interpret the outcome: reloading
 * shows the source's real state either way.
 */
export const refreshFeed = createServerFn({ method: "POST" }).middleware([workspaceWriteMiddleware])
  .validator((d: any) => z.object({ feedId: z.string() }).parse(d))
  .handler(async ({ data }) => {
    // Refresh triggers an outbound fetch to a URL the row supplies, so
    // ownership is checked before the id is used for anything.
    await assertOwnsFeed(data.feedId)

    const [feed] = await db
      .select({
        id: feeds.id,
        url: feeds.url,
        kind: feeds.kind,
        entitlementPausedAt: feeds.entitlementPausedAt,
      })
      .from(feeds)
      .where(eq(feeds.id, data.feedId))
      .limit(1)
    if (!feed) throw new Error(NOT_FOUND_MSG)
    if (feed.entitlementPausedAt) {
      return { ok: false as const, inserted: 0 }
    }

    try {
      const { inserted, failed } = await ingestFeeds([{ feedId: feed.id, url: feed.url, kind: feed.kind }])
      return { ok: failed === 0, inserted }
    } catch {
      // The failure is already recorded on the feed row. Reporting it as a
      // thrown error here would only turn a handled state into a toast.
      return { ok: false as const, inserted: 0 }
    }
  })

// ─────────────────────────────────────────────
// REFRESH SINGLE FOLDER
// ─────────────────────────────────────────────

export const refreshFolder = createServerFn({ method: "POST" }).middleware([workspaceWriteMiddleware])
  .validator((d: any) => z.object({ folderId: z.string() }).parse(d))
  .handler(async ({ data }) => {
    // Scoped by workspace as well as folder: a folder id alone is guessable,
    // and refresh is an outbound-fetch trigger.
    const workspaceId = await resolveWorkspaceId()
    const folderFeeds = await db
      .select()
      .from(feeds)
      .where(
        and(
          eq(feeds.folderId, data.folderId),
          feedInWorkspace(workspaceId),
          isNull(feeds.entitlementPausedAt)
        )
      )

    return ingestFeeds(folderFeeds.map((f) => ({ feedId: f.id, url: f.url, kind: f.kind })))
  })

// ─────────────────────────────────────────────
// ARTICLE ACTIONS
// ─────────────────────────────────────────────

/**
 * The three reader-state toggles are deliberately written out one by one rather
 * than generated by a helper.
 *
 * `createServerFn(...).handler(...)` is a build-time AST transform: the plugin
 * finds each syntactic occurrence and swaps the handler for an RPC stub in the
 * client build. A factory returning the call has only one occurrence, so the
 * transform does not apply and the handler body ships to the browser, which
 * then tries to run a Drizzle UPDATE client-side and silently does nothing.
 *
 * The shared part that is safe to factor out is the WHERE clause:
 * `articleInWorkspace` scopes the update to the caller's workspace. Without it
 * these took an id and updated it unconditionally, which was survivable only
 * while the sole caller was a UI that never rendered another workspace's ids.
 */

export const toggleBookmark = createServerFn({ method: "POST" }).middleware([workspaceWriteMiddleware])
  .validator(z.object({ id: z.string(), state: z.boolean() }))
  .handler(async ({ data }) => {
    const workspaceId = await resolveWorkspaceId()
    await db
      .update(articles)
      .set({ isBookmarked: data.state })
      .where(and(eq(articles.id, data.id), articleInWorkspace(workspaceId)))
  })

export const toggleReadLater = createServerFn({ method: "POST" }).middleware([workspaceWriteMiddleware])
  .validator(z.object({ id: z.string(), state: z.boolean() }))
  .handler(async ({ data }) => {
    const workspaceId = await resolveWorkspaceId()
    await db
      .update(articles)
      .set({ isReadLater: data.state })
      .where(and(eq(articles.id, data.id), articleInWorkspace(workspaceId)))
  })

export const toggleFavorite = createServerFn({ method: "POST" }).middleware([workspaceWriteMiddleware])
  .validator(z.object({ id: z.string(), state: z.boolean() }))
  .handler(async ({ data }) => {
    await writeFavorites(await resolveWorkspaceContext(), [data.id], "personal", data.state)
  })

// ─────────────────────────────────────────────
// ARTICLE PREVIEW (in-app full-blog reader)
// ─────────────────────────────────────────────

/**
 * Accepts a bare row id or a prefixed one.
 *
 * The app's own list views hold the raw `articles.id`, but everything that came
 * back through the tool registry carries the `art_` prefix `encodeId` adds —
 * that prefix is the API's contract with the model, and the AI cards hand their
 * ids straight to the panel. Comparing a prefixed id against `articles.id`
 * matched nothing, so *every* Read button on an article card in Spark AI opened
 * the reader on "Not found".
 *
 * Normalising here rather than at the two call sites: it is one rule about what
 * an article id may look like, and a third caller would otherwise have to
 * rediscover it.
 */
function articleRowId(id: string): string {
  return id.startsWith("art_") ? id.slice(4) : id
}

// Returns sanitized reader HTML for an article plus whether its source page can
// be embedded in an <iframe> (Live mode). Reader HTML comes from cache first,
// otherwise the page is fetched once, extracted with Readability, and cached.
export const getArticlePreview = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string(), workspaceId: z.string().optional(), userId: z.string().optional() }))
  .handler(async ({ data }) => {
    // Workspace-scoped because this is an outbound-fetch primitive: an
    // unscoped id would let a caller make the server fetch any URL stored in
    // any workspace's articles table.
    const context = await resolveWorkspaceContext()
    const { workspaceId } = context
    if ((data.workspaceId && data.workspaceId !== workspaceId) || (data.userId && data.userId !== context.userId)) throw new Error("Workspace changed. Reload this page.")
    const rows = await db
      .select({
        id: articles.id,
        link: articles.link,
        content: articles.content,
        description: articles.description,
      })
      .from(articles)
      .where(
        and(
          eq(articles.id, articleRowId(data.id)),
          articleInWorkspace(workspaceId)
        )
      )
      .limit(1)

    const article = rows[0]
    if (!article) throw new Error(NOT_FOUND_MSG)

    const link = article.link
    const domain = previewDomain(link)

    let readerHtml: string | null = article.content ?? null
    let canEmbed = false

    if (readerHtml) {
      // Content already cached — just probe headers to decide Live availability.
      try {
        const res = await safeFetch(link, { method: "HEAD", timeoutMs: 5000 })
        canEmbed = checkCanEmbed(res.headers)
      } catch {
        canEmbed = false
      }
    } else {
      // No cached content: one fetch serves both extraction and the header check.
      try {
        const { res, text: html } = await safeFetchText(link, {
          timeoutMs: 8000,
        })
        canEmbed = checkCanEmbed(res.headers)
        const extracted = extractReadable(html, link)
        if (extracted) {
          readerHtml = extracted.contentHtml
          try {
            await db
              .update(articles)
              // `article.id` rather than the requested one: the caller may have
              // passed a prefixed id, and the row we just read is the truth.
              .set({
                content: readerHtml,
                contentFetchedAt: new Date().toISOString(),
              })
              .where(
                and(
                  eq(articles.id, article.id),
                  articleInWorkspace(workspaceId)
                )
              )
          } catch {
            // Caching is best-effort; ignore write failures.
          }
        }
      } catch {
        readerHtml = null
        canEmbed = false
      }
    }

    // Last resort: show the (sanitized) RSS snippet rather than nothing.
    if (!readerHtml && article.description) {
      readerHtml = sanitizeArticleHtml(article.description, link)
    }

    return { readerHtml, canEmbed, link, domain }
  })

export const deleteFeed = createServerFn({ method: "POST" }).middleware([workspaceWriteMiddleware])
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    if (DEMO_MODE) throw new Error(DEMO_LOCKED_MSG)
    // Ownership is checked up front rather than folded into each WHERE: the
    // cascade below deletes by feedId, so a single guard covers all three
    // statements and there is no window where a partial delete has happened.
    await assertOwnsFeed(data.id)
    // Delete feedShares first (FK → feeds.id)
    await db.delete(feedShares).where(eq(feedShares.feedId, data.id))
    // Delete articles (FK → feeds.id)
    await db.delete(articles).where(eq(articles.feedId, data.id))
    // Now safe to delete the feed
    await db.delete(feeds).where(eq(feeds.id, data.id))
  })

export const deleteFolder = createServerFn({ method: "POST" }).middleware([workspaceWriteMiddleware])
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    if (DEMO_MODE) throw new Error(DEMO_LOCKED_MSG)
    const workspaceId = await assertOwnsFolder(data.id)
    // Cascade lives in services/folder-delete so it can be tested against a
    // real database — nothing in this schema uses ON DELETE CASCADE, so the
    // ordering is the whole correctness story.
    await deleteFolderTree(db, data.id, workspaceId)
  })

/** One row in the manage-folder table. */
export interface ManagedSource {
  id: string
  name: string
  url: string
  /**
   * How the source is read. This used to be derived from which table the row
   * came from, because there was no column for it; `feeds.kind` records it now
   * and both kinds live in one table.
   */
  type: "rss" | "scraped"
  articleCount: number
  createdAt: string | null
  lastFetchedAt: string | null
  lastError: string | null
  lastErrorAt: string | null
}

export const getFolderManageData = createServerFn({ method: "GET" })
  .validator(z.object({ folderId: z.string() }))
  .handler(
    async ({
      data,
    }): Promise<{
      folder: {
        id: string
        name: string
        isShared: boolean
        hasPassword: boolean
      }
      sources: Array<ManagedSource>
    }> => {
      const workspaceId = await assertOwnsFolder(data.folderId)

      const [folderRow] = await db
        .select({
          id: folders.id,
          name: folders.name,
          isShared: folderShares.isShared,
          password: folderShares.password,
        })
        .from(folders)
        .leftJoin(folderShares, eq(folders.id, folderShares.folderId))
        .where(eq(folders.id, data.folderId))
        .limit(1)
      if (!folderRow) throw new Error(NOT_FOUND_MSG)

      const rssFeeds = await db
        .select({
          id: feeds.id,
          name: feeds.name,
          url: feeds.url,
          kind: feeds.kind,
          createdAt: feeds.createdAt,
          lastFetchedAt: feeds.lastFetchedAt,
          lastError: feeds.lastError,
          lastErrorAt: feeds.lastErrorAt,
        })
        .from(feeds)
        .where(
          and(eq(feeds.folderId, data.folderId), feedInWorkspace(workspaceId))
        )
        .orderBy(...FEED_ORDER)

      // Real totals, not the count of whatever the reader happens to have loaded
      // — the sidebar badge counts the ≤200 articles in memory.
      const counts = new Map<string, number>()
      if (rssFeeds.length > 0) {
        const rows = await db
          .select({ feedId: articles.feedId, value: count() })
          .from(articles)
          .where(
            inArray(
              articles.feedId,
              rssFeeds.map((f) => f.id)
            )
          )
          .groupBy(articles.feedId)
        for (const r of rows)
          if (r.feedId) counts.set(r.feedId, Number(r.value))
      }

      const sources: Array<ManagedSource> = [
        ...rssFeeds.map((f) => ({
          id: f.id,
          name: f.name,
          url: f.url,
          type: f.kind === "page" ? ("scraped" as const) : ("rss" as const),
          articleCount: counts.get(f.id) ?? 0,
          createdAt: f.createdAt ?? null,
          lastFetchedAt: f.lastFetchedAt ?? null,
          lastError: f.lastError ?? null,
          lastErrorAt: f.lastErrorAt ?? null,
        })),
      ]

      return {
        folder: {
          id: folderRow.id,
          name: folderRow.name,
          isShared: !!folderRow.isShared,
          hasPassword: !!folderRow.password,
        },
        sources,
      }
    }
  )

export const renameFolder = createServerFn({ method: "POST" }).middleware([workspaceWriteMiddleware])
  .validator(z.object({ id: z.string(), name: z.string().min(1) }))
  .handler(async ({ data }) => {
    if (DEMO_MODE) throw new Error(DEMO_LOCKED_MSG)
    const workspaceId = await resolveWorkspaceId()
    await db
      .update(folders)
      .set({ name: data.name })
      .where(and(eq(folders.id, data.id), folderInWorkspace(workspaceId)))
  })

export const renameFeed = createServerFn({ method: "POST" }).middleware([workspaceWriteMiddleware])
  .validator(z.object({ id: z.string(), name: z.string().min(1) }))
  .handler(async ({ data }) => {
    if (DEMO_MODE) throw new Error(DEMO_LOCKED_MSG)
    const workspaceId = await resolveWorkspaceId()
    await db
      .update(feeds)
      .set({ name: data.name })
      .where(and(eq(feeds.id, data.id), feedInWorkspace(workspaceId)))
  })

export const updateFeed = createServerFn({ method: "POST" }).middleware([workspaceWriteMiddleware])
  .validator((d: any) =>
    z
      .object({
        id: z.string(),
        name: z.string().min(1),
        url: feedUrlSchema,
        folderId: z.string().nullable(),
        includeKeywords: z.array(z.string()),
        excludeKeywords: z.array(z.string()),
      })
      .parse(d)
  )
  .handler(
    async ({
      data,
    }): Promise<
      { status: "ok"; url: string } | { status: "error"; error: FeedError }
    > => {
      if (DEMO_MODE) return { status: "error", error: feedError("demo_locked") }

      const workspaceId = await resolveWorkspaceId()

      // Existing rows already hold a resolved feed URL, so an unchanged URL must
      // not be re-resolved (that would cost a network round trip on every rename).
      const [existing] = await db
        .select({ url: feeds.url })
        .from(feeds)
        .where(and(eq(feeds.id, data.id), feedInWorkspace(workspaceId)))
        .limit(1)

      // A missing row here means the feed is gone or belongs to someone else.
      // Bailing out matters: without it, an unowned id fell through to the
      // resolve branch and made the server fetch an attacker-chosen URL.
      if (!existing) return { status: "error", error: feedError("not_found") }

      /*
      The destination folder needs checking too, and did not used to be.
      The query above proves you own the *feed*; `data.folderId` was written
      straight through, so a caller could move their own feed into a folder
      belonging to another workspace — where it would then show up in that
      workspace's sidebar. `createFeed` has the same shape and the same gap.
    */
      if (data.folderId) {
        const [destination] = await db
          .select({ id: folders.id })
          .from(folders)
          .where(
            and(eq(folders.id, data.folderId), folderInWorkspace(workspaceId))
          )
          .limit(1)
        if (!destination)
          return { status: "error", error: feedError("not_found") }
      }

      let url = data.url
      if (existing.url !== data.url) {
        let resolved: ResolvedFeed | null
        try {
          resolved = await resolveFeed(data.url)
        } catch (err) {
          return { status: "error", error: toFeedError(err) }
        }
        if (!resolved)
          return { status: "error", error: feedError("not_a_feed") }
        url = resolved.url
      }

      await db
        .update(feeds)
        .set({
          name: data.name,
          url,
          folderId: data.folderId,
          includeKeywords: JSON.stringify(data.includeKeywords),
          excludeKeywords: JSON.stringify(data.excludeKeywords),
        })
        .where(and(eq(feeds.id, data.id), feedInWorkspace(workspaceId)))

      return { status: "ok", url }
    }
  )
