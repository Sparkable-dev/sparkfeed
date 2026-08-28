import { and, count, gte, inArray, max, min } from "drizzle-orm"
import type { Database } from "@/db/client"
import { articles } from "@/db/schema"

/**
 * How often each feed publishes, and when it last did.
 *
 * Two aggregates over `articles`, shared by the home dashboard and `/sources`
 * because both render the same status dot and the same "every 8h · 2h ago"
 * pair. Deriving them twice would mean two chances to disagree about what
 * "quiet" means.
 *
 * The interpretation lives in `@/lib/source-health` — this returns the raw
 * window and nothing else, so the rule for turning it into a status stays in
 * one place too, on the client where it is rendered.
 *
 * Named `feed-health` rather than `source-health` so it cannot be confused with
 * that client module in an import list.
 */

const DAY_MS = 24 * 60 * 60 * 1000

export interface FeedHealthWindow {
  /** Posts in the last 30 days. */
  posts30d: number
  /** Oldest and newest post inside that window, which is what gives the interval. */
  firstAt30d: string | null
  lastAt30d: string | null
  /**
   * Newest post ever. Separate from `lastAt30d` on purpose: a feed silent for
   * six months has nothing in the window but still has a last post, and
   * "Never" and "6 months ago" are very different things to show a user.
   */
  lastPostAt: string | null
}

export async function feedHealthByFeed(
  db: Database,
  feedIds: Array<string>,
  now: number = Date.now(),
): Promise<Map<string, FeedHealthWindow>> {
  const health = new Map<string, FeedHealthWindow>()
  if (feedIds.length === 0) return health

  // `published_at` is always written as `toISOString()` (see utils/dates.ts),
  // so this string comparison is chronological in both Postgres and SQLite.
  const since30d = new Date(now - 30 * DAY_MS).toISOString()
  const scope = inArray(articles.feedId, feedIds)

  const [window30d, lastEver] = await Promise.all([
    db
      .select({
        feedId: articles.feedId,
        posts: count(),
        firstAt: min(articles.publishedAt),
        lastAt: max(articles.publishedAt),
      })
      .from(articles)
      .where(and(scope, gte(articles.publishedAt, since30d)))
      .groupBy(articles.feedId),
    db
      .select({ feedId: articles.feedId, lastAt: max(articles.publishedAt) })
      .from(articles)
      .where(scope)
      .groupBy(articles.feedId),
  ])

  for (const id of feedIds) {
    health.set(id, { posts30d: 0, firstAt30d: null, lastAt30d: null, lastPostAt: null })
  }
  for (const row of window30d) {
    const entry = row.feedId ? health.get(row.feedId) : undefined
    if (!entry) continue
    entry.posts30d = Number(row.posts)
    entry.firstAt30d = row.firstAt ?? null
    entry.lastAt30d = row.lastAt ?? null
  }
  for (const row of lastEver) {
    const entry = row.feedId ? health.get(row.feedId) : undefined
    if (entry) entry.lastPostAt = row.lastAt ?? null
  }

  return health
}
