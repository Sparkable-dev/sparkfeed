import { and, eq, inArray } from "drizzle-orm"
import { folderInWorkspace } from "./tenancy"
import type { Database } from "@/db/client"
import {
  articles,
  feedShares,
  feeds,
  folderShares,
  folders,
} from "@/db/schema"

/**
 * Deleting a folder has to be done by hand, statement by statement.
 *
 * Not one table in this schema uses ON DELETE CASCADE — every foreign key is
 * `no action` — and `scraped_feeds` / `scraped_articles` have no foreign keys at
 * all. The database will neither cascade nor complain, so anything missed here
 * simply lingers.
 *
 * These take the database handle rather than reaching for the singleton so the
 * ordering can be tested against a real database. It is the kind of logic that
 * reads correctly and still leaves rows behind.
 */

/**
 * Every folder in the subtree, children before parents.
 *
 * `deleteFolder` never recursed, so sub-folders survived with a dangling
 * `parent_id` — still listed, still refreshing. `folders.parent_id` has no
 * self-referencing foreign key and nothing prevents a cycle, so the seen-set is
 * a real guard rather than a formality.
 */
export async function collectFolderSubtree(
  db: Database,
  rootId: string,
  workspaceId: string | null,
): Promise<Array<string>> {
  const seen = new Set<string>()
  const order: Array<string> = []

  const walk = async (id: string) => {
    if (seen.has(id)) return
    seen.add(id)
    const children = await db
      .select({ id: folders.id })
      .from(folders)
      .where(and(eq(folders.parentId, id), folderInWorkspace(workspaceId)))
    for (const child of children) await walk(child.id)
    order.push(id)
  }

  await walk(rootId)
  return order
}

/**
 * Removes everything belonging to one folder, but not the folder row itself.
 *
 * Scraped sources are the ones that used to be missed, and they were not a
 * cosmetic leak: the scraper cron iterates `scraped_feeds` unfiltered, so an
 * orphaned source kept being re-fetched forever, inserting fresh articles for a
 * folder the user had deleted — which the reader then showed, because
 * `getAllData` reaches scraped articles by `site_url`. `site_url` is also
 * globally unique, so the orphan blocked re-adding the same site later.
 */
export async function purgeFolderContents(
  db: Database,
  folderId: string,
): Promise<void> {
  const childFeeds = await db
    .select({ id: feeds.id })
    .from(feeds)
    .where(eq(feeds.folderId, folderId))

  if (childFeeds.length > 0) {
    const feedIds = childFeeds.map((f) => f.id)
    // feed_shares and articles both reference feeds.id, so they go first.
    await db.delete(feedShares).where(inArray(feedShares.feedId, feedIds))
    await db.delete(articles).where(inArray(articles.feedId, feedIds))
  }
  await db.delete(feeds).where(eq(feeds.folderId, folderId))

  /*
    Watched pages need no cascade of their own any more. They used to live in
    `scraped_feeds` with articles joined by URL string rather than by id, so
    deleting a folder had to hunt them down separately — and rows whose source
    had already gone were orphaned. Both are `feeds` and `articles` rows now and
    go with the deletes above.
  */
  await db.delete(folderShares).where(eq(folderShares.folderId, folderId))
}

/** The whole subtree, contents and folder rows, children first. */
export async function deleteFolderTree(
  db: Database,
  rootId: string,
  workspaceId: string | null,
): Promise<Array<string>> {
  const order = await collectFolderSubtree(db, rootId, workspaceId)
  for (const id of order) {
    await purgeFolderContents(db, id)
    await db.delete(folders).where(eq(folders.id, id))
  }
  return order
}
