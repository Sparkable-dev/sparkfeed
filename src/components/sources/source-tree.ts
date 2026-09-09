import type { FeedRow, FolderRow } from "@/lib/rss-types"
import type { SourceHealthRow } from "@/server/sources-data"
import { slugify } from "@/lib/slugify"
import { UNFILED_LABEL } from "@/lib/unfiled"

/**
 * The shape `/sources` renders and drags, derived from what the loader already
 * carries.
 *
 * A tree rather than the two flat lists `getAllData` returns, because every
 * question the page asks is "what is inside this folder, in what order" and
 * answering that with a filter per row is how the sidebar ended up doing
 * `feeds.filter(...)` inside a `folders.map(...)`.
 *
 * Pure and React-free so the reorder maths can be tested without rendering.
 */

/** Feeds outside any folder. Not a folder: it cannot be renamed, shared or dragged. */
export const UNGROUPED_ID = "__ungrouped__"

export interface TreeFeed {
  id: string
  name: string
  url: string
  isShared: boolean
  hasPassword: boolean
  /** Null only for a feed the health query has not seen, which should not happen. */
  health: SourceHealthRow | null
  /** Where the feed's own page lives, which depends on whether it has a folder. */
  href: string
  /** `page` for a site with no feed that we read from its listing. */
  kind: string | null
}

export interface TreeFolder {
  id: string
  name: string
  /** False for the Ungrouped bucket, which has no row of its own to act on. */
  isRealFolder: boolean
  isShared: boolean
  hasPassword: boolean
  href: string
  feeds: Array<TreeFeed>
}

export function buildTree(
  folders: Array<FolderRow>,
  feeds: Array<FeedRow>,
  health: Record<string, SourceHealthRow>,
): Array<TreeFolder> {
  const feedsByFolder = new Map<string, Array<FeedRow>>()
  for (const feed of feeds) {
    const key = feed.folderId ?? UNGROUPED_ID
    const bucket = feedsByFolder.get(key)
    if (bucket) bucket.push(feed)
    else feedsByFolder.set(key, [feed])
  }

  const toTreeFeed = (feed: FeedRow, folderName: string | null): TreeFeed => ({
    id: feed.id,
    name: feed.name,
    url: feed.url,
    isShared: !!feed.isShared,
    hasPassword: !!feed.hasPassword,
    health: health[feed.id] ?? null,
    kind: feed.kind ?? "rss",
    // Routes resolve a feed by slugified folder name plus slugified feed name,
    // and a folderless feed lives somewhere else entirely.
    href: folderName
      ? `/${slugify(folderName)}/${slugify(feed.name)}`
      : `/feed/${slugify(feed.name)}`,
  })

  const tree: Array<TreeFolder> = folders.map((folder) => ({
    id: folder.id,
    name: folder.name,
    isRealFolder: true,
    isShared: !!folder.isShared,
    hasPassword: !!folder.hasPassword,
    href: `/${slugify(folder.name)}`,
    feeds: (feedsByFolder.get(folder.id) ?? []).map((f) => toTreeFeed(f, folder.name)),
  }))

  /*
    Always present, even when empty, and always last. It is the only place a
    feed can be dropped to take it out of every folder, so it cannot appear and
    disappear depending on whether anything currently lives there.
  */
  tree.push({
    id: UNGROUPED_ID,
    name: UNFILED_LABEL,
    isRealFolder: false,
    isShared: false,
    hasPassword: false,
    href: "/all",
    feeds: (feedsByFolder.get(UNGROUPED_ID) ?? []).map((f) => toTreeFeed(f, null)),
  })

  return tree
}

/**
 * The arrangement, flattened for the wire.
 *
 * The Ungrouped bucket becomes `folderId: null`, which is what it means in the
 * database, and is dropped from the folder list because it is not a folder.
 */
export function toOrderPayload(tree: Array<TreeFolder>): {
  folders: Array<string>
  feeds: Array<{ id: string; folderId: string | null }>
} {
  return {
    folders: tree.filter((f) => f.isRealFolder).map((f) => f.id),
    feeds: tree.flatMap((folder) =>
      folder.feeds.map((feed) => ({
        id: feed.id,
        folderId: folder.isRealFolder ? folder.id : null,
      })),
    ),
  }
}

/**
 * A cheap string identity for an arrangement.
 *
 * Used for three jobs that would otherwise each need their own comparison: is
 * this drag a no-op, did the save that just failed leave us somewhere the
 * server never saw, and has the loader brought back something genuinely
 * different from what we last committed.
 */
export function signature(tree: Array<TreeFolder>): string {
  return tree
    .map((folder) => `${folder.id}:${folder.feeds.map((f) => f.id).join(",")}`)
    .join("|")
}

/** Moves an item within an array, returning a new one. */
export function moveWithin<T>(items: Array<T>, from: number, to: number): Array<T> {
  const next = items.slice()
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

export function findFeed(
  tree: Array<TreeFolder>,
  feedId: string,
): { folderIndex: number; feedIndex: number } | null {
  for (let f = 0; f < tree.length; f++) {
    const index = tree[f].feeds.findIndex((feed) => feed.id === feedId)
    if (index !== -1) return { folderIndex: f, feedIndex: index }
  }
  return null
}

/**
 * Moves a feed to a position in a (possibly different) folder.
 *
 * Returns the same array when the move is a no-op, so callers can use identity
 * to skip a save without comparing signatures first.
 */
export function moveFeed(
  tree: Array<TreeFolder>,
  feedId: string,
  toFolderIndex: number,
  toFeedIndex: number,
): Array<TreeFolder> {
  const from = findFeed(tree, feedId)
  if (!from) return tree
  if (from.folderIndex === toFolderIndex && from.feedIndex === toFeedIndex) return tree

  const next = tree.map((folder) => ({ ...folder, feeds: folder.feeds.slice() }))
  const [feed] = next[from.folderIndex].feeds.splice(from.feedIndex, 1)

  const target = next[toFolderIndex]
  const index = Math.max(0, Math.min(toFeedIndex, target.feeds.length))
  target.feeds.splice(index, 0, feed)

  return next
}
