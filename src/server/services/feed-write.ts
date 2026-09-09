import { randomUUID } from "node:crypto"
import { and, isNull } from "drizzle-orm"
import { feedInWorkspace, folderInWorkspace } from "./tenancy"
import { assertOwnsFolder } from "./ownership"
import { enqueueIngest } from "./ingest-queue"
import { db } from "@/db/index"
import { feeds, folders } from "@/db/schema"
import { feedUrlKey } from "@/lib/validation"
import { withNoRssSourceCapacity } from "@/server/entitlements/enforce"

/**
 * The one way rows get written for a new subscription.
 *
 * Four places used to do this — the bulk add, the single add, the AI/REST
 * writer and the catalogue import — and each invented its own duplicate check
 * and its own folder naming. The two that mattered actively disagreed:
 * `verify_feed` reported "already subscribed" using a normalised comparison
 * while the insert matched the URL exactly, so the app could tell you a feed
 * was already there and then add it a second time.
 *
 * A plain module rather than a `createServerFn` one, deliberately. Exporting a
 * Drizzle-using function *from* a server-fn module drags the ORM into the
 * browser bundle (see the note in `sources-write.ts`); importing one *into*
 * such a module is fine, which is what makes this shareable.
 */

/** Longest folder name we will store. Anything longer is truncated, not refused. */
export const MAX_FOLDER_NAME = 60

/**
 * Where a batch of feeds is going.
 *
 * A tagged union rather than `folderId: string | null` plus a separate
 * `newFolderName`, because those two were expressible together and meant
 * nothing when they were. The dialog offers exactly these three choices, so
 * the wire format is the choice itself.
 */
export type Destination =
  | { kind: "none" }
  | { kind: "existing"; folderId: string }
  | { kind: "new"; name: string }

/**
 * Every feed URL the workspace already has, as comparison keys.
 *
 * One query for the whole list rather than one per candidate: building the Add
 * dialog's result list used to issue a SELECT for each of up to twelve
 * candidates just to draw "already added" beside them.
 */
export async function existingFeedKeys(
  workspaceId: string | null
): Promise<Set<string>> {
  const rows = await db
    .select({ url: feeds.url })
    .from(feeds)
    .where(feedInWorkspace(workspaceId))
  return new Set(rows.map((r) => feedUrlKey(r.url)))
}

/**
 * A folder name fit to store, or null if there is nothing left after cleaning.
 *
 * The old `createFolder` did none of this: no trim, no length cap, so a
 * pasted paragraph became a folder name and a name of spaces became a folder
 * you could not see in the sidebar.
 */
export function cleanFolderName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ").slice(0, MAX_FOLDER_NAME).trim()
  return name.length > 0 ? name : null
}

/**
 * Finds a free folder name.
 *
 * Auto-suffixes rather than returning a conflict for the caller to resolve.
 * `add-to-workspace` does the opposite — it 409s and opens a rename dialog —
 * and that is right there, because the user deliberately chose to copy one
 * specific shared folder. Interrupting an add-feed flow with a naming dialog is
 * the difference between a feature people use and one they abandon.
 *
 * Moved here from `catalogue.ts` so the Add dialog can reach it: that file is a
 * server-fn module, and exporting this from it would have pulled Drizzle into
 * the client bundle.
 */
export async function freeFolderName(
  workspaceId: string | null,
  desired: string
): Promise<string> {
  const taken = await db
    .select({ name: folders.name })
    .from(folders)
    .where(folderInWorkspace(workspaceId))
  const names = new Set(taken.map((f) => f.name))

  if (!names.has(desired)) return desired
  for (let n = 2; n <= 20; n++) {
    const candidate = `${desired} (${n})`
    if (!names.has(candidate)) return candidate
  }
  return `${desired} (${Date.now()})`
}

/**
 * Turns a destination into the folder id rows should carry, creating the folder
 * if that is what was asked for.
 *
 * Called before any outbound work, so an unowned destination cannot make the
 * server go and resolve URLs on someone else's behalf. Callers must only invoke
 * this once they know at least one row is going in — that is what retires the
 * old "delete the folder again if nothing was added" cleanup.
 */
export async function resolveDestination(
  workspaceId: string | null,
  destination: Destination
): Promise<string | null> {
  if (destination.kind === "none") return null

  if (destination.kind === "existing") {
    await assertOwnsFolder(destination.folderId, workspaceId)
    return destination.folderId
  }

  const cleaned = cleanFolderName(destination.name)
  if (!cleaned) return null

  const id = randomUUID()
  await db.insert(folders).values({
    id,
    name: await freeFolderName(workspaceId, cleaned),
    workspaceId,
  })
  return id
}

export interface NewFeed {
  url: string
  name: string
  /** `rss` (default) or `page` for a site read from its listing. */
  kind?: string
  includeKeywords?: Array<string>
  excludeKeywords?: Array<string>
}

export interface InsertedFeed {
  id: string
  url: string
  name: string
}

/**
 * Writes the rows and hands the fetching to the queue.
 *
 * Articles are deliberately *not* fetched inline. The bulk path used to loop
 * one feed at a time, each waiting on a live HTTP fetch, so twenty URLs was a
 * one-to-three-minute spinner. Every URL reaching here has already been
 * resolved and parsed during the check step, so the second fetch proves nothing
 * the caller does not already know — and a feed that does fail later shows up
 * as broken on /sources with a Retry button, which is more visible than the
 * old behaviour of silently deleting the row again.
 */
export async function insertFeedRows(
  workspaceId: string | null,
  folderId: string | null,
  items: Array<NewFeed>
): Promise<Array<InsertedFeed>> {
  if (items.length === 0) return []

  const rows = items.map((item) => ({
    id: randomUUID(),
    name: item.name,
    url: item.url,
    kind: item.kind ?? "rss",
    folderId,
    workspaceId,
    includeKeywords: JSON.stringify(item.includeKeywords ?? []),
    excludeKeywords: JSON.stringify(item.excludeKeywords ?? []),
  }))

  await withNoRssSourceCapacity(workspaceId, items.filter((item) => item.kind === "page").length, async (tx) => { await tx.insert(feeds).values(rows) })
  enqueueIngest(rows.map((r) => ({ feedId: r.id, url: r.url, kind: r.kind })))

  return rows.map((r) => ({ id: r.id, url: r.url, name: r.name }))
}

/**
 * Re-queues feeds that were inserted but never fetched.
 *
 * The ingest queue is an unawaited promise in the request handler, which
 * survives the user closing the tab but not a deploy or a restart. A feed that
 * lost its turn has no `last_fetched_at` and no `last_error_at` — it has never
 * been *attempted*, a state nothing else produces — so it is safe to simply try
 * again. `enqueueIngest` refuses to double-queue a feed already in flight, so
 * this is idempotent and cheap to call on a page load.
 *
 * Takes rows rather than querying when the caller already has them: /sources
 * loads exactly these columns for its status dots, so the recovery costs it
 * nothing at all.
 */
export function requeueUnfetchedFrom(
  rows: Array<{
    id: string
    url: string
    kind?: string | null
    lastFetchedAt: unknown
    lastErrorAt: unknown
    entitlementPausedAt?: unknown
  }>
): number {
  const stalled = rows.filter(
    (r) => !r.entitlementPausedAt && !r.lastFetchedAt && !r.lastErrorAt
  )
  if (stalled.length === 0) return 0
  enqueueIngest(
    stalled.map((r) => ({ feedId: r.id, url: r.url, kind: r.kind }))
  )
  return stalled.length
}

/** The querying form, for callers that do not already hold the rows. */
export async function requeueUnfetched(
  workspaceId: string | null
): Promise<number> {
  const rows = await db
    .select({
      id: feeds.id,
      url: feeds.url,
      kind: feeds.kind,
    })
    .from(feeds)
    .where(
      and(
        feedInWorkspace(workspaceId),
        isNull(feeds.entitlementPausedAt),
        isNull(feeds.lastFetchedAt),
        isNull(feeds.lastErrorAt)
      )
    )

  if (rows.length === 0) return 0
  enqueueIngest(rows.map((r) => ({ feedId: r.id, url: r.url, kind: r.kind })))
  return rows.length
}
