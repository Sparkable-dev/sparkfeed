import { randomUUID } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { inspectWebsite } from "../utils/website-preview"
import { ingestSource } from "../utils/fetch-page-articles"
import { withNoRssSourceCapacity } from "../entitlements/enforce"
import { fetchAndInsertArticles } from "../utils/fetch-articles"
import { resolveFeed } from "../utils/detectRSS"
import { decodeId, encodeId } from "./ids"
import { cleanFolderName, existingFeedKeys, freeFolderName } from "./feed-write"
import { feedInWorkspace, folderInWorkspace } from "./tenancy"
import {
  ServiceError,
  invalidArgument,
  notFound,
  upstreamFailed,
} from "./errors"
import type { ApiPrincipal } from "../api/principal"
import { feeds, folders } from "@/db/schema"
import { db } from "@/db/index"
import { feedUrlKey } from "@/lib/validation"

/**
 * The three write operations an agent is allowed to perform on sources.
 *
 * Every one of them refuses in demo. That is not belt-and-braces with the
 * scope check — the demo principal genuinely has no write scope — but a demo
 * deployment is public, and a public endpoint that mutates shared state on
 * request is worth refusing twice.
 *
 * All ids in and out are prefixed. Decoding is done here rather than in the
 * tool layer so the same rule holds for every caller, which is precisely the
 * mistake `listFeeds` used to make.
 */

function assertWritable(principal: ApiPrincipal) {
  if (principal.demo) {
    throw new ServiceError("forbidden", "Changes are disabled in demo mode.")
  }
}

/** Verifies a folder belongs to this workspace before anything is written into it. */
async function assertFolder(
  principal: ApiPrincipal,
  folderId: string
): Promise<string> {
  const raw = decodeId("folder", folderId)
  const [row] = await db
    .select({ id: folders.id })
    .from(folders)
    .where(and(eq(folders.id, raw), folderInWorkspace(principal.workspaceId)))
    .limit(1)
  if (!row) throw notFound("Folder")
  return raw
}

export async function createFolder(
  principal: ApiPrincipal,
  args: { name: string; parentId?: string }
) {
  assertWritable(principal)

  const cleaned = cleanFolderName(args.name)
  if (!cleaned) throw invalidArgument("A folder needs a name.")

  const parentRaw = args.parentId
    ? await assertFolder(principal, args.parentId)
    : null

  // Suffixed rather than refused, matching every other path that creates a
  // folder. A model asked to file things under "AI" twice should get "AI (2)",
  // not an error it has to reason about.
  const name = await freeFolderName(principal.workspaceId, cleaned)

  const id = randomUUID()
  await db.insert(folders).values({
    id,
    name,
    parentId: parentRaw,
    workspaceId: principal.workspaceId,
  })

  return {
    folder: {
      id: encodeId("folder", id),
      name,
      parent_id: parentRaw ? encodeId("folder", parentRaw) : null,
    },
  }
}

/**
 * Subscribe to a feed.
 *
 * The URL is resolved first, so pasting a homepage works the same as pasting a
 * feed — that resolution is the whole reason `find_feeds` and this share a
 * code path.
 *
 * The insert deliberately does *not* reuse `addRssFeed` from `server/rss.ts`,
 * even though that function does the same job. `rss.ts` is a `createServerFn`
 * module, so it is part of the **client** build with its handler bodies
 * stripped; a plain exported function there can no longer be tree-shaken out,
 * and its `db` usage drags Drizzle and node built-ins into the browser bundle.
 * Exporting it broke the chat page outright. `fetchAndInsertArticles` is a
 * plain server util with no such entanglement, so the ~15 lines of duplicate
 * detection and rollback are re-stated here instead.
 */
export async function addFeed(
  principal: ApiPrincipal,
  args: { url: string; folderId?: string; name?: string; allowScrape?: boolean }
) {
  assertWritable(principal)

  const folderRaw = args.folderId
    ? await assertFolder(principal, args.folderId)
    : null

  let resolved
  try {
    resolved = await resolveFeed(args.url)
  } catch (err) {
    throw upstreamFailed(
      err instanceof Error ? err.message : "Could not reach that URL."
    )
  }
  const website =
    !resolved && args.allowScrape ? await inspectWebsite(args.url) : null
  const source = resolved ?? website
  if (!source) {
    throw upstreamFailed(`No RSS or Atom feed found at ${args.url}.`)
  }

  /*
    The same comparison the Add dialog and `verify_feed` use. It used to be an
    exact string match here, which meant the app could report a feed as already
    subscribed and then let this path add it again under a trailing slash.
  */
  const existing = await existingFeedKeys(principal.workspaceId)
  if (existing.has(feedUrlKey(source.url))) {
    // Not a failure the model should retry — say so plainly.
    throw invalidArgument("That feed is already in this workspace.")
  }

  const id = randomUUID()
  const name = args.name?.trim() || source.title || source.url

  const values = {
    id,
    name,
    url: source.url,
    kind: website ? "page" : "rss",
    folderId: folderRaw,
    workspaceId: principal.workspaceId,
    includeKeywords: JSON.stringify([]),
    excludeKeywords: JSON.stringify([]),
  }
  if (website)
    await withNoRssSourceCapacity(principal.workspaceId, 1, async (tx) => {
      await tx.insert(feeds).values(values)
    })
  else await db.insert(feeds).values(values)

  let imported = 0
  try {
    const result = website
      ? await ingestSource(id, source.url, "page")
      : await fetchAndInsertArticles(id, source.url)
    // Every row rejected means the feed parsed but we could not store it —
    // our problem, not the user's. Roll back rather than leaving behind a
    // subscription that will never show anything.
    if (result.inserted === 0 && result.failed > 0) {
      await db
        .delete(feeds)
        .where(eq(feeds.id, id))
        .catch(() => {})
      throw upstreamFailed("Could not import articles from that feed.")
    }
    imported = result.inserted
  } catch (err) {
    if (err instanceof ServiceError) throw err
    await db
      .delete(feeds)
      .where(eq(feeds.id, id))
      .catch(() => {})
    throw upstreamFailed(
      err instanceof Error ? err.message : "Could not add that feed."
    )
  }

  return {
    feed: {
      id: encodeId("feed", id),
      name,
      url: source.url,
      folder_id: folderRaw ? encodeId("folder", folderRaw) : null,
    },
    articles_imported: imported,
  }
}

/** Move a feed between folders. A null `folderId` moves it to the top level. */
export async function moveFeed(
  principal: ApiPrincipal,
  args: { feedId: string; folderId: string | null }
) {
  assertWritable(principal)

  const feedRaw = decodeId("feed", args.feedId)
  const folderRaw = args.folderId
    ? await assertFolder(principal, args.folderId)
    : null

  const [existing] = await db
    .select({ id: feeds.id, name: feeds.name })
    .from(feeds)
    .where(and(eq(feeds.id, feedRaw), feedInWorkspace(principal.workspaceId)))
    .limit(1)
  if (!existing) throw notFound("Feed")

  await db
    .update(feeds)
    // `position` is cleared because it is an order *within* a folder; carrying
    // it across would drop the feed at an arbitrary index in its new home.
    // Null sorts last, so it lands at the bottom — see `folders.position`.
    .set({ folderId: folderRaw, position: null })
    .where(and(eq(feeds.id, feedRaw), feedInWorkspace(principal.workspaceId)))

  return {
    feed: {
      id: encodeId("feed", feedRaw),
      name: existing.name,
      folder_id: folderRaw ? encodeId("folder", folderRaw) : null,
    },
  }
}
