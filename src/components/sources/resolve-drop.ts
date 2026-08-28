import { parseDragId, parseDropZoneId } from "./SortableRows"
import { findFeed, moveFeed, moveWithin } from "./source-tree"
import type { TreeFolder } from "./source-tree"

/**
 * What a drop means, as a pure function.
 *
 * Separated from `SourcesDnd` because this is the one piece of drag logic that
 * can genuinely be wrong in a way nothing else catches: the tree helpers are
 * tested, the mutation is tested, and everything in between was "the drop
 * handler looked right". A feed that lands one row off, or a folder that can be
 * dropped past the Ungrouped bucket, renders perfectly and saves the wrong
 * arrangement.
 *
 * Returns null when the drop should do nothing, so the caller does not have to
 * distinguish "no change" from "not allowed".
 */
export function resolveDrop(
  tree: Array<TreeFolder>,
  activeId: string | number,
  overId: string | number,
): Array<TreeFolder> | null {
  const from = parseDragId(activeId)
  if (!from) return null

  if (from.kind === "folder") {
    const to = parseDragId(overId)
    // Folders reorder only among themselves. Dropping one onto a feed, or onto
    // the Ungrouped bucket, means nothing — that bucket is a destination for
    // feeds, not a position in the folder list.
    if (!to || to.kind !== "folder") return null

    const fromIndex = tree.findIndex((f) => f.id === from.id)
    const toIndex = tree.findIndex((f) => f.id === to.id)
    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return null
    if (!tree[toIndex].isRealFolder) return null

    return moveWithin(tree, fromIndex, toIndex)
  }

  // A feed dropped on a folder's body: append it there.
  const bodyFolderId = parseDropZoneId(overId)
  if (bodyFolderId !== null) {
    const targetIndex = tree.findIndex((f) => f.id === bodyFolderId)
    if (targetIndex === -1) return null

    const current = findFeed(tree, from.id)
    /*
      Dropping into the folder it already lives in does nothing, rather than
      jumping to the end. Hovering a folder header on the way past is the
      commonest accidental drop there is, and silently sending a feed to the
      bottom of its own list would look like a bug.
    */
    if (current?.folderIndex === targetIndex) return null

    const result = moveFeed(tree, from.id, targetIndex, tree[targetIndex].feeds.length)
    return result === tree ? null : result
  }

  // A feed dropped on another feed: take that feed's place.
  const to = parseDragId(overId)
  if (!to || to.kind !== "feed") return null

  const target = findFeed(tree, to.id)
  if (!target) return null

  const result = moveFeed(tree, from.id, target.folderIndex, target.feedIndex)
  return result === tree ? null : result
}
