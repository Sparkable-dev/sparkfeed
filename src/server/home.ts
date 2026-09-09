import { createServerFn } from "@tanstack/react-start"
import { and, count, countDistinct, desc, gte, inArray } from "drizzle-orm"
import { ARTICLE_LIST_COLUMNS } from "./services/projections"
import { feedHealthByFeed } from "./services/feed-health"
import { resolveWorkspaceContext } from "./services/context"
import { feedInWorkspace, folderInWorkspace } from "./services/tenancy"
import { FEED_ORDER, FOLDER_ORDER } from "./services/ordering"
import { db } from "@/db/index"
import { articles, feeds, folders } from "@/db/schema"
import { slugify } from "@/lib/slugify"
import { UNFILED_LABEL } from "@/lib/unfiled"

/**
 * Everything the home page shows, in the shape it shows it.
 *
 * Home asks per folder so busy feeds cannot crowd out quiet sources.
 * Its aggregate counts come from the database, not the displayed sample.
 *
 * RSS feeds and watched pages both use the same feeds/articles tables.
 */

/** Rows per folder. Fetched deeper than shown so link-dedupe has slack. */
const PER_SECTION = 14

/**
 * Folders shown as rows, most recently active first.
 *
 * Each row is its own query, so this is a cap on round trips as much as on
 * page length. Anything past it is one click away in the sidebar.
 */
const MAX_SECTIONS = 8

/** Cards for the hero carousel and the row under it, before dedupe. */
const LATEST_POOL = 24

const DAY_MS = 24 * 60 * 60 * 1000

export interface HomeArticle {
  id: string
  feedId: string | null
  title: string
  description: string | null
  link: string
  image: string | null
  publishedAt: string | null
  isUsed: boolean | null
  visitCount: number | null
  isBookmarked: boolean | null
  isReadLater: boolean | null
  isFavorite: boolean | null
  createdAt: string | null
}

/** One folder row on the home page. */
export interface HomeSection {
  /** Null for feeds that are not in a folder. */
  id: string | null
  name: string
  /** Where "See all" goes. */
  href: string
  /** Articles published in the last 24 hours across this folder's feeds. */
  newCount: number
  articles: Array<HomeArticle>
}

/**
 * One source's publishing record, as far back as we have fetched it.
 *
 * The two "last" fields are different facts and both are needed. `lastPostAt`
 * is the publisher's clock and answers "has this gone quiet". `lastFetchedAt`
 * is ours and answers "are we still reaching it". Showing one in place of the
 * other reports our cron schedule as editorial cadence.
 */
export interface HomeSource {
  id: string
  name: string
  url: string
  folderId: string | null
  /** The folder this sits in, for the table's second column. */
  folderName: string | null
  /**
   * This feed's own page.
   *
   * Built here because it needs the parent folder's name, which the client
   * would have to look up again: the routes resolve a feed by slugified folder
   * name plus slugified feed name, and a feed with no folder lives somewhere
   * else entirely (`/feed/$feedSlug`).
   */
  href: string
  createdAt: string | null
  /** Posts in the last 30 days. */
  posts30d: number
  /** Oldest and newest post inside that window, for the interval. */
  firstAt30d: string | null
  lastAt30d: string | null
  /** Newest post ever, so a source quiet for months still reports one. */
  lastPostAt: string | null
  lastFetchedAt: string | null
  /** Set only when the most recent fetch failed; cleared on success. */
  lastError: string | null
  lastErrorAt: string | null
}

export interface HomeData {
  sections: Array<HomeSection>
  latest: Array<HomeArticle>
  sources: Array<HomeSource>
  /** Distinct links published in the last 24 hours. */
  newCount: number
  /** Sources that published in that window. */
  activeSourceCount: number
  totalSourceCount: number
}

const EMPTY: HomeData = {
  sections: [],
  latest: [],
  sources: [],
  newCount: 0,
  activeSourceCount: 0,
  totalSourceCount: 0,
}

export const getHomeData = createServerFn({ method: "GET" }).handler(
  async (): Promise<HomeData> => {
    const { workspaceId } = await resolveWorkspaceContext()

    const [folderRows, feedRows] = await Promise.all([
      db
        .select({ id: folders.id, name: folders.name, createdAt: folders.createdAt })
        .from(folders)
        .where(folderInWorkspace(workspaceId))
        .orderBy(...FOLDER_ORDER),
      db
        .select({
          id: feeds.id,
          name: feeds.name,
          url: feeds.url,
          folderId: feeds.folderId,
          createdAt: feeds.createdAt,
          lastFetchedAt: feeds.lastFetchedAt,
          lastError: feeds.lastError,
          lastErrorAt: feeds.lastErrorAt,
        })
        .from(feeds)
        .where(feedInWorkspace(workspaceId))
        .orderBy(...FEED_ORDER),
    ])

    const feedIds = feedRows.map((f) => f.id)
    if (feedIds.length === 0) return EMPTY

    const now = Date.now()
    // `published_at` is always written as `toISOString()` (see utils/dates.ts),
    // so these string comparisons are chronological in both Postgres and SQLite.
    const since24h = new Date(now - DAY_MS).toISOString()

    const inWorkspaceFeeds = inArray(articles.feedId, feedIds)

    const [health, recentPerFeed, totals, latest] = await Promise.all([
      // Shared with /sources, which renders the same cadence and status.
      feedHealthByFeed(db, feedIds, now),
      db
        .select({ feedId: articles.feedId, posts: count() })
        .from(articles)
        .where(and(inWorkspaceFeeds, gte(articles.publishedAt, since24h)))
        .groupBy(articles.feedId),
      /*
        Distinct links, not rows. Subscribing to a site's main feed and one of
        its section feeds delivers the same story twice, and the headline count
        has to match what the page actually renders after dedupe.
      */
      db
        .select({ links: countDistinct(articles.link) })
        .from(articles)
        .where(and(inWorkspaceFeeds, gte(articles.publishedAt, since24h))),
      db
        .select(ARTICLE_LIST_COLUMNS)
        .from(articles)
        .where(inWorkspaceFeeds)
        .orderBy(desc(articles.publishedAt))
        .limit(LATEST_POOL),
    ])

    const posts24hByFeed = new Map<string, number>()
    for (const row of recentPerFeed) {
      if (row.feedId) posts24hByFeed.set(row.feedId, Number(row.posts))
    }

    const folderNames = new Map(folderRows.map((f) => [f.id, f.name]))

    const sources: Array<HomeSource> = feedRows.map((feed) => {
      const w = health.get(feed.id)
      const folderName = feed.folderId ? (folderNames.get(feed.folderId) ?? null) : null
      return {
        id: feed.id,
        name: feed.name,
        url: feed.url,
        folderId: feed.folderId ?? null,
        folderName,
        href: folderName
          ? `/${slugify(folderName)}/${slugify(feed.name)}`
          : `/feed/${slugify(feed.name)}`,
        createdAt: feed.createdAt ?? null,
        posts30d: w?.posts30d ?? 0,
        firstAt30d: w?.firstAt30d ?? null,
        lastAt30d: w?.lastAt30d ?? null,
        lastPostAt: w?.lastPostAt ?? null,
        lastFetchedAt: feed.lastFetchedAt ?? null,
        lastError: feed.lastError ?? null,
        lastErrorAt: feed.lastErrorAt ?? null,
      }
    })

    /*
      Candidate rows, ranked before they are fetched. Each section costs a
      query, so the cap has to be applied to the list rather than to the
      results — and ranking by recent activity means the cap drops the folders
      with the least to say rather than the ones created last.
    */
    const feedsByFolder = new Map<string | null, Array<string>>()
    for (const feed of feedRows) {
      const key = feed.folderId ?? null
      const bucket = feedsByFolder.get(key)
      if (bucket) bucket.push(feed.id)
      else feedsByFolder.set(key, [feed.id])
    }

    const candidates = [
      // Folder hrefs are derived from the name, matching how the routes resolve
      // them: `$folderSlug/index.tsx` looks a folder up by slugified name
      // rather than by a stored slug.
      ...folderRows.map((folder) => ({
        id: folder.id,
        name: folder.name,
        href: `/${slugify(folder.name)}`,
        feedIds: feedsByFolder.get(folder.id) ?? [],
      })),
      // Standalone feeds have no shared page, so their row points at the wall.
      ...(feedsByFolder.has(null)
        ? [
            {
              id: null,
              name: UNFILED_LABEL,
              href: "/all",
              feedIds: feedsByFolder.get(null) ?? [],
            },
          ]
        : []),
    ]
      .filter((c) => c.feedIds.length > 0)
      .map((c) => ({
        ...c,
        newCount: c.feedIds.reduce((sum, id) => sum + (posts24hByFeed.get(id) ?? 0), 0),
      }))
      .sort((a, b) => b.newCount - a.newCount)
      .slice(0, MAX_SECTIONS)

    const sections = (
      await Promise.all(
        candidates.map(async (candidate) => ({
          id: candidate.id,
          name: candidate.name,
          href: candidate.href,
          newCount: candidate.newCount,
          articles: await db
            .select(ARTICLE_LIST_COLUMNS)
            .from(articles)
            .where(inArray(articles.feedId, candidate.feedIds))
            .orderBy(desc(articles.publishedAt))
            .limit(PER_SECTION),
        })),
      )
    ).filter((section) => section.articles.length > 0)

    return {
      sections,
      latest,
      sources,
      newCount: Number(totals[0]?.links ?? 0),
      activeSourceCount: posts24hByFeed.size,
      totalSourceCount: feedRows.length,
    }
  },
)
