import { and, eq, isNotNull, sql } from "drizzle-orm"
import {
  articleInWorkspace,
  feedInWorkspace,
  folderInWorkspace,
} from "./tenancy"
import { apiFavoriteCondition } from "./favorites"
import type { ApiPrincipal } from "../api/principal"
import { articles, feeds, folders } from "@/db/schema"
import { db } from "@/db/index"

/**
 * Workspace aggregates.
 *
 * Two portability rules govern everything in this file, and breaking either one
 * only shows up in demo:
 *
 * 1. **No `FILTER (WHERE …)`.** It is Postgres-only, and demo runs the same
 *    Postgres table objects against SQLite. `sum(case when … then 1 else 0 end)`
 *    is the portable equivalent. The comparison inside the CASE is built with
 *    Drizzle's `eq()` rather than a literal `= false`, so the boolean is bound
 *    per dialect (SQLite stores 0/1).
 *
 * 2. **Group, never loop.** Per-folder and per-feed numbers come from one
 *    `group by`, not a query per row. `listFolders` already computes its feed
 *    count in JS from a full scan; that pattern must not spread to articles,
 *    which are orders of magnitude more numerous.
 *
 * Note `scraped_articles` carries no read/favourite state at all, so unread and
 * favourite numbers describe RSS articles only. Scraped sources are counted as
 * sources but contribute no article stats — see `kind` in `listFeeds`.
 */

/** `sum(case when <cond> then 1 else 0 end)`, dialect-safe. */
function countWhere(condition: ReturnType<typeof eq>) {
  return sql<number>`sum(case when ${condition} then 1 else 0 end)`
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()
}

const n = (value: unknown): number => Number(value ?? 0)

export interface WorkspaceCounts {
  folders: number
  feeds: number
  feeds_rss: number
  feeds_scraped: number
  articles_total: number
  articles_30d: number
  unread: number
  favorites: number
}

export interface FolderStat {
  id: string
  name: string
  parent_id: string | null
  feed_count: number
  article_count: number
  unread_count: number
}

export interface FeedStat {
  feedId: string
  article_count: number
  unread_count: number
  posts_30d: number
  last_published_at: string | null
}

/** Headline counts. Three queries, regardless of workspace size. */
export async function workspaceCounts(
  principal: ApiPrincipal
): Promise<WorkspaceCounts> {
  const { workspaceId } = principal
  const cutoff = daysAgo(30)
  const favorite = await apiFavoriteCondition(principal)

  // Four independent counts in parallel, rather than one row of scalar
  // subqueries: the subquery form needs a dummy FROM, and the portable spelling
  // of that differs between Postgres and SQLite.
  const [folderRows, feedRows, articleRows] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)` })
      .from(folders)
      .where(folderInWorkspace(workspaceId)),
    // One query for both kinds. Watched pages are `feeds` rows now, so the
    // split is a column rather than a second table.
    db
      .select({ kind: feeds.kind, n: sql<number>`count(*)` })
      .from(feeds)
      .where(feedInWorkspace(workspaceId))
      .groupBy(feeds.kind),
    db
      .select({
        total: sql<number>`count(*)`,
        unread: countWhere(eq(articles.isUsed, false)),
        favorites: countWhere(favorite),
        recent: sql<number>`sum(case when coalesce(${articles.publishedAt}, ${articles.createdAt}) >= ${cutoff} then 1 else 0 end)`,
      })
      .from(articles)
      .where(articleInWorkspace(workspaceId)),
  ])

  const rss = n(feedRows.find((r) => r.kind !== "page")?.n)
  const scraped = n(feedRows.find((r) => r.kind === "page")?.n)

  return {
    folders: n(folderRows[0]?.n),
    feeds: rss + scraped,
    feeds_rss: rss,
    feeds_scraped: scraped,
    articles_total: n(articleRows[0]?.total),
    articles_30d: n(articleRows[0]?.recent),
    unread: n(articleRows[0]?.unread),
    favorites: n(articleRows[0]?.favorites),
  }
}

/**
 * Article counts keyed by folder id, in one grouped query.
 * The `null` key holds feeds that sit at the top level.
 */
export async function articleCountsByFolder(
  principal: ApiPrincipal
): Promise<
  Map<string | null, { article_count: number; unread_count: number }>
> {
  const rows = await db
    .select({
      folderId: feeds.folderId,
      total: sql<number>`count(*)`,
      unread: countWhere(eq(articles.isUsed, false)),
    })
    .from(articles)
    .innerJoin(feeds, eq(feeds.id, articles.feedId))
    .where(feedInWorkspace(principal.workspaceId))
    .groupBy(feeds.folderId)

  return new Map(
    rows.map((r) => [
      r.folderId,
      { article_count: n(r.total), unread_count: n(r.unread) },
    ])
  )
}

/** Per-feed article stats, keyed by raw feed id, in one grouped query. */
export async function articleStatsByFeed(
  principal: ApiPrincipal
): Promise<Map<string, FeedStat>> {
  const cutoff = daysAgo(30)

  const rows = await db
    .select({
      feedId: articles.feedId,
      total: sql<number>`count(*)`,
      unread: countWhere(eq(articles.isUsed, false)),
      recent: sql<number>`sum(case when coalesce(${articles.publishedAt}, ${articles.createdAt}) >= ${cutoff} then 1 else 0 end)`,
      lastPublished: sql<
        string | null
      >`max(coalesce(${articles.publishedAt}, ${articles.createdAt}))`,
    })
    .from(articles)
    .innerJoin(feeds, eq(feeds.id, articles.feedId))
    .where(feedInWorkspace(principal.workspaceId))
    .groupBy(articles.feedId)

  // `articles.feed_id` is nullable in the schema, so the group can contain a
  // null bucket. It cannot be keyed to a feed, so it is dropped rather than
  // coerced into a bogus id.
  return new Map(
    rows
      .filter((r): r is typeof r & { feedId: string } => r.feedId !== null)
      .map((r) => [
        r.feedId,
        {
          feedId: r.feedId,
          article_count: n(r.total),
          unread_count: n(r.unread),
          posts_30d: n(r.recent),
          last_published_at: r.lastPublished ?? null,
        },
      ])
  )
}

/**
 * Feeds that need a human: a fetch error on record, or never fetched at all.
 * This is the half of "how is my workspace doing" that a count cannot express.
 */
export async function unhealthyFeeds(principal: ApiPrincipal, limit = 10) {
  const rows = await db
    .select({
      id: feeds.id,
      name: feeds.name,
      url: feeds.url,
      lastError: feeds.lastError,
      lastErrorAt: feeds.lastErrorAt,
      lastFetchedAt: feeds.lastFetchedAt,
    })
    .from(feeds)
    .where(
      and(
        feedInWorkspace(principal.workspaceId),
        sql`(${isNotNull(feeds.lastError)} or ${feeds.lastFetchedAt} is null)`
      )
    )
    .limit(limit)

  return rows.map((f) => ({
    id: f.id,
    name: f.name,
    url: f.url,
    last_error: f.lastError,
    last_error_at: f.lastErrorAt,
    never_fetched: f.lastFetchedAt === null,
  }))
}

export interface DayBucket {
  /** `YYYY-MM-DD`, local to UTC. */
  date: string
  count: number
}

/**
 * Articles per day, for a chart.
 *
 * Everything else in this file is a scalar or a group-by-entity; this is the
 * first group-by-time, and it needs two things nothing else here did.
 *
 * **The bucket is computed in SQL by string slice, not by a date function.**
 * `date_trunc` is Postgres-only and `strftime` is SQLite-only, and these
 * timestamps are stored as ISO-8601 text — where the first ten characters are
 * the date, in both dialects, with no parsing. `substr` is one of the few
 * things both agree on exactly.
 *
 * **Empty days are filled in afterwards.** SQL returns only days that have
 * rows, and a chart drawn straight from that silently closes the gaps — a feed
 * that went quiet for a week renders as a smooth line rather than the flat spot
 * it was. The zero-fill is what makes the shape honest.
 */
export async function articlesPerDay(
  principal: ApiPrincipal,
  args: { days: number; folderId?: string | null; feedId?: string | null } = {
    days: 30,
  }
): Promise<Array<DayBucket>> {
  const days = Math.min(Math.max(Math.round(args.days), 1), 365)
  const cutoff = daysAgo(days)

  const when = sql`coalesce(${articles.publishedAt}, ${articles.createdAt})`
  const bucket = sql<string>`substr(${when}, 1, 10)`

  const filters = [feedInWorkspace(principal.workspaceId), sql`${when} >= ${cutoff}`]
  if (args.folderId) filters.push(eq(feeds.folderId, args.folderId))
  if (args.feedId) filters.push(eq(articles.feedId, args.feedId))

  const rows = await db
    .select({ date: bucket, total: sql<number>`count(*)` })
    .from(articles)
    .innerJoin(feeds, eq(feeds.id, articles.feedId))
    .where(and(...filters))
    .groupBy(bucket)

  const found = new Map(rows.map((r) => [String(r.date), n(r.total)]))

  const out: Array<DayBucket> = []
  const start = new Date()
  start.setUTCHours(0, 0, 0, 0)
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(start.getTime() - i * 86_400_000)
      .toISOString()
      .slice(0, 10)
    out.push({ date, count: found.get(date) ?? 0 })
  }
  return out
}
