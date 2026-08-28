import type { SourceStatus } from "@/lib/source-health"
import type { TreeFolder } from "./source-tree"
import { daysSince, sourceStatus } from "@/lib/source-health"

/**
 * What the strip at the top of /sources is counting.
 *
 * Derived from the tree the page already holds rather than from a new query.
 * Every number here is a fold over `posts30d`, `lastPostAt` and the error
 * columns, all of which arrive with `getSourceHealth` for the status dots — so
 * the overview costs a pass over an array in memory, not a round trip.
 *
 * Pure and React-free so the arithmetic can be tested directly. The rendering
 * is in `SourcesOverview`.
 */

/** The window every count here is measured over. Matches `feedHealthByFeed`. */
export const WINDOW_DAYS = 30

/**
 * Where the quadrant splits, and the reason each line is where it is.
 *
 * Both are printed on the chart. A divider whose position is a judgement call
 * has to say what the judgement was, otherwise the reader has no way to tell a
 * measured threshold from a pleasing one.
 */
export const QUIET_AFTER_DAYS = 7
/** Roughly one post a week across the window. */
export const REGULAR_POSTS = 4

/** Right-hand edge of the freshness axis. Beyond this, all silence looks alike. */
export const SILENCE_CAP_DAYS = 30

/** One source, reduced to the two facts the quadrant plots. */
export interface SourcePoint {
  id: string
  name: string
  /** Posts in the last 30 days. */
  posts30d: number
  /**
   * Whole days since the most recent post, or null if it has never posted.
   *
   * Null is not zero and not infinity: a feed added an hour ago that has not
   * produced anything yet is a different thing from one that went silent in
   * March, and the chart pins it to the stale edge but colours it as new.
   */
  quietDays: number | null
  status: SourceStatus
}

export interface SourcesOverview {
  feedCount: number
  /** Real folders only. The unfiled bucket is a rendering device, not a folder. */
  folderCount: number
  /** Posts across every source in the window. */
  posts30d: number
  /** Always all four keys, so a legend can render a zero rather than a gap. */
  byStatus: Record<SourceStatus, number>
  /** Posts per folder in the window, busiest first. */
  byFolder: Array<{ label: string; value: number }>
  points: Array<SourcePoint>
}

/**
 * Folders shown as bars.
 *
 * A ranking stops being one somewhere around here, and this chart occupies a
 * third of a strip that is supposed to be glanceable. What falls off the end is
 * summed rather than dropped — see `buildOverview`.
 */
const MAX_BARS = 6

export function buildOverview(
  tree: Array<TreeFolder>,
  now = Date.now(),
): SourcesOverview {
  const byStatus: Record<SourceStatus, number> = {
    active: 0,
    quiet: 0,
    broken: 0,
    new: 0,
  }

  const points: Array<SourcePoint> = []
  const folderTotals: Array<{ label: string; value: number }> = []
  let posts30d = 0
  let feedCount = 0
  let folderCount = 0

  for (const folder of tree) {
    if (folder.isRealFolder) folderCount++

    let folderPosts = 0
    for (const feed of folder.feeds) {
      feedCount++

      // A feed the health query has not seen yet: countable, but with nothing
      // to say. Treated as new rather than dropped, so the totals still add up
      // to the number of rows in the table below.
      const status = feed.health ? sourceStatus(feed.health, now) : "new"
      byStatus[status]++

      const posts = feed.health?.posts30d ?? 0
      folderPosts += posts
      posts30d += posts

      points.push({
        id: feed.id,
        name: feed.name,
        posts30d: posts,
        quietDays: daysSince(feed.health?.lastPostAt ?? null, now),
        status,
      })
    }

    // An empty folder contributes no bar. It is visible in the table, where its
    // emptiness is the actionable fact; here it would be a label against zero.
    if (folder.feeds.length > 0) {
      folderTotals.push({ label: folder.name, value: folderPosts })
    }
  }

  folderTotals.sort((a, b) => b.value - a.value)

  /*
    Everything past the cap becomes one bar rather than vanishing. A chart that
    silently shows six of eleven folders reads as a complete picture of where
    the volume comes from, and is not one.
  */
  const byFolder =
    folderTotals.length > MAX_BARS
      ? [
          ...folderTotals.slice(0, MAX_BARS - 1),
          {
            label: `${folderTotals.length - (MAX_BARS - 1)} more folders`,
            value: folderTotals
              .slice(MAX_BARS - 1)
              .reduce((sum, folder) => sum + folder.value, 0),
          },
        ]
      : folderTotals

  return { feedCount, folderCount, posts30d, byStatus, byFolder, points }
}

/** Which corner of the quadrant a source falls in. */
export type Quadrant = "busy" | "stalled" | "occasional" | "dormant"

export function quadrantOf(point: SourcePoint): Quadrant {
  // Never posted counts as maximally stale: there is no date to compare, but
  // "we have never seen anything from this" is the strongest form of the thing
  // the right-hand column is about.
  const stale = point.quietDays === null || point.quietDays >= QUIET_AFTER_DAYS
  const regular = point.posts30d >= REGULAR_POSTS

  if (regular) return stale ? "stalled" : "busy"
  return stale ? "dormant" : "occasional"
}

export function countByQuadrant(
  points: Array<SourcePoint>,
): Record<Quadrant, number> {
  const counts: Record<Quadrant, number> = {
    busy: 0,
    stalled: 0,
    occasional: 0,
    dormant: 0,
  }
  for (const point of points) counts[quadrantOf(point)]++
  return counts
}
