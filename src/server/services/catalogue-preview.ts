import { and, asc, eq, inArray, isNull, notInArray } from "drizzle-orm"
import { ensureCatalogueSynced } from "./catalogue"
import type { Database } from "@/db/client"
import { db as singleton } from "@/db/index"
import { catalogueArticles, catalogueFeeds } from "@/db/schema"
import { feedImageOf, fetchFeedItems, safeParseDate } from "@/server/utils/fetch-articles"
import { decodeEntities } from "@/server/utils/entities"

/**
 * Recent articles for Discover cards, so a source can be read before it is added.
 *
 * The catalogue is the same page for every user, so this cache is global rather
 * than workspace-scoped: the first person to open a card pays for the fetch and
 * everybody after them gets it for free. Nothing here is authored — the table
 * can be truncated at any point and refills on the next view.
 */

/** How long a feed's articles are served before we look again. */
const TTL_MS = 6 * 60 * 60 * 1000

/**
 * The preview applies no age limit at all — it shows a feed's most recent items
 * whatever their dates.
 *
 * It started at 30 days and that was wrong. Y Combinator's blog last posted 50
 * days ago, so a perfectly healthy feed rendered "Nothing published recently"
 * and there was no way to judge it; two of the first seventeen feeds opened hit
 * this. An empty box tells you nothing about a source, whereas a headline dated
 * June tells you both what it publishes and how often — which is the more useful
 * half of the answer. Every row carries its real date, so nothing is oversold.
 *
 * Ingest still windows to 30 days. That is a different question: how much
 * history to import, not what to show someone deciding.
 */

/** Deliberately shorter than the ingest timeout — this one is in front of a user. */
const FETCH_TIMEOUT_MS = 7_000
const MAX_ITEMS = 12
/** Feeds routinely put an entire post in the summary. */
const MAX_DESCRIPTION = 400

export interface PreviewArticle {
  link: string
  title: string
  description: string | null
  image: string | null
  publishedAt: string | null
}

export type PreviewFeedState = "ok" | "empty" | "unavailable"

export interface PreviewFeed {
  slug: string
  state: PreviewFeedState
  articles: Array<PreviewArticle>
}

/**
 * One refresh per feed at a time, process-wide.
 *
 * The TTL alone does not prevent a stampede: ten people opening the same card in
 * the same second all read "stale" before any of them writes, and all ten fetch.
 * Same latch as `ensureCatalogueSynced`, including clearing the entry on failure
 * so one transient error does not wedge the feed for the life of the process.
 */
const inFlight = new Map<string, Promise<void>>()

function refreshOnce(db: Database, slug: string, url: string): Promise<void> {
  const existing = inFlight.get(slug)
  if (existing) return existing

  const run = refreshFeed(db, slug, url).finally(() => inFlight.delete(slug))
  inFlight.set(slug, run)
  return run
}

/**
 * Replaces one feed's cached articles.
 *
 * Delete-then-insert rather than upsert: a dozen rows makes the write trivial
 * either way, and replacing means an item the feed has dropped cannot linger,
 * `sortOrder` stays honest, and there is no `onConflict` target to get wrong
 * across the SQLite cast that demo mode runs through.
 */
async function refreshFeed(db: Database, slug: string, url: string): Promise<void> {
  const now = new Date().toISOString()

  let rows: Array<typeof catalogueArticles.$inferInsert> = []
  let error: string | null = null

  try {
    const items = await fetchFeedItems(url, { timeoutMs: FETCH_TIMEOUT_MS })

    const seen = new Set<string>()
    rows = items
      .map((item) => ({
        item,
        publishedAt: safeParseDate(item.isoDate || item.pubDate),
      }))
      // Feed order is not reliably chronological, and a carousel makes that
      // obvious in a way an article list never did. Undated items sort last
      // rather than being dropped — some good feeds simply have no dates.
      .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
      .filter(({ item }) => {
        if (seen.has(item.link)) return false
        seen.add(item.link)
        return true
      })
      .slice(0, MAX_ITEMS)
      .map(({ item, publishedAt }, index) => ({
        feedSlug: slug,
        link: item.link,
        title: decodeEntities(item.title?.trim() || "") || "Untitled",
        description:
          decodeEntities((item.contentSnippet ?? item.summary)?.trim() ?? "").slice(
            0,
            MAX_DESCRIPTION,
          ) || null,
        image: feedImageOf(item),
        publishedAt,
        sortOrder: index,
        fetchedAt: now,
      }))
  } catch (err) {
    error = String(err instanceof Error ? err.message : err).slice(0, 500)
  }

  if (!error) {
    await db.delete(catalogueArticles).where(eq(catalogueArticles.feedSlug, slug))
    if (rows.length > 0) await db.insert(catalogueArticles).values(rows)
  }

  /**
   * Stamped even when the fetch failed. If the timestamp only advanced on
   * success, a feed that 403s would be refetched on every single card open
   * forever — the TTL would disengage for exactly the feeds that cost most.
   *
   * `status` and `failureStreak` are pointedly NOT touched. Those belong to the
   * validator script, and the catalogue read filters on `status`: letting a
   * preview write them would mean one network blip during one user's dialog
   * could remove that card from Discover for everybody.
   */
  await db
    .update(catalogueFeeds)
    .set({ articlesFetchedAt: now, articlesError: error })
    .where(eq(catalogueFeeds.slug, slug))
}

interface ResolvedFeed {
  slug: string
  feedUrl: string
  fetchedAt: string | null
}

/**
 * Resolves a card's feeds from the database.
 *
 * Never from the request body — the client sends a slug and nothing else, for
 * the same reason `importCatalogueItem` reads its URLs here rather than
 * trusting what it was handed. Mirrors `readCatalogue`'s filters so a stale
 * bookmark cannot resurrect a retired source.
 */
async function resolveFeeds(
  db: Database,
  kind: "collection" | "feed",
  slug: string,
): Promise<Array<ResolvedFeed>> {
  const rows = await db
    .select({
      slug: catalogueFeeds.slug,
      feedUrl: catalogueFeeds.feedUrl,
      fetchedAt: catalogueFeeds.articlesFetchedAt,
    })
    .from(catalogueFeeds)
    .where(
      and(
        kind === "feed"
          ? eq(catalogueFeeds.slug, slug)
          : eq(catalogueFeeds.collectionSlug, slug),
        isNull(catalogueFeeds.retiredAt),
        notInArray(catalogueFeeds.status, ["dead"]),
      ),
    )
    .orderBy(asc(catalogueFeeds.sortOrder))

  return rows
}

function isStale(fetchedAt: string | null): boolean {
  if (!fetchedAt) return true
  return Date.now() - new Date(fetchedAt).getTime() > TTL_MS
}

/**
 * The articles behind one Discover card.
 *
 * Stale-while-revalidate: anything already cached is returned at once and the
 * refresh runs detached, so only the very first viewer of a feed ever waits.
 * That detached promise must never reject — an unhandled rejection takes the
 * Node process down — hence the `.catch` on the way out.
 */
export async function getCataloguePreview(
  kind: "collection" | "feed",
  slug: string,
  db: Database = singleton,
): Promise<{ feeds: Array<PreviewFeed> }> {
  // A deep link on a cold process would otherwise find an empty table.
  await ensureCatalogueSynced()

  const resolved = await resolveFeeds(db, kind, slug)
  if (resolved.length === 0) return { feeds: [] }

  const cold = resolved.filter((f) => !f.fetchedAt)
  const stale = resolved.filter((f) => f.fetchedAt && isStale(f.fetchedAt))

  // allSettled, not all: one feed that 403s must not take down the two healthy
  // ones beside it in the same collection.
  if (cold.length > 0) {
    await Promise.allSettled(cold.map((f) => refreshOnce(db, f.slug, f.feedUrl)))
  }
  for (const feed of stale) {
    void refreshOnce(db, feed.slug, feed.feedUrl).catch(() => {})
  }

  return { feeds: await readCachedArticles(db, resolved) }
}

async function readCachedArticles(
  db: Database,
  resolved: Array<ResolvedFeed>,
): Promise<Array<PreviewFeed>> {
  const slugs = resolved.map((f) => f.slug)

  // The error column is re-read rather than taken from `resolved`, because a
  // refresh may have just written it. Reading the pre-refresh copy would report
  // a feed that failed a moment ago as merely quiet.
  const [rows, health] = await Promise.all([
    db
      .select()
      .from(catalogueArticles)
      .where(inArray(catalogueArticles.feedSlug, slugs))
      .orderBy(asc(catalogueArticles.sortOrder)),
    db
      .select({ slug: catalogueFeeds.slug, error: catalogueFeeds.articlesError })
      .from(catalogueFeeds)
      .where(inArray(catalogueFeeds.slug, slugs)),
  ])

  const failed = new Set(health.filter((h) => h.error !== null).map((h) => h.slug))

  const bySlug = new Map<string, Array<PreviewArticle>>(slugs.map((s) => [s, []]))
  for (const row of rows) {
    bySlug.get(row.feedSlug)?.push({
      link: row.link,
      title: row.title,
      description: row.description,
      image: row.image,
      publishedAt: row.publishedAt,
    })
  }

  return resolved.map((feed) => {
    const articles = bySlug.get(feed.slug) ?? []
    if (articles.length > 0) return { slug: feed.slug, state: "ok" as const, articles }
    // Nothing cached is two different situations, and the UI says different
    // things about them: a quiet feed is still worth adding, a broken one is not.
    return {
      slug: feed.slug,
      state: failed.has(feed.slug) ? ("unavailable" as const) : ("empty" as const),
      articles: [],
    }
  })
}

/** Test seam: the single-flight map outlives a test file otherwise. */
export function __resetPreviewState() {
  inFlight.clear()
}
