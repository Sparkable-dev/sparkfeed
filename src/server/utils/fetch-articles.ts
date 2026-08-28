import { randomUUID } from "node:crypto"
import { and, eq, inArray } from "drizzle-orm"
import Parser from "rss-parser"
import { looksLikeFeedContentType, safeFetchText } from "./fetch"
import { safeParseDate } from "./dates"
import { sanitizeArticleHtml } from "./extract"
import { decodeEntities } from "./entities"
import { articles, feeds } from "@/db/schema"
import { db } from "@/db/index"

export { safeParseDate }

export type RssItem = {
  link?: string
  title?: string
  contentSnippet?: string
  contentEncoded?: string
  summary?: string
  pubDate?: string
  isoDate?: string
  mediaContent?: { $?: { url?: string } }
  mediaThumbnail?: { $?: { url?: string } }
  enclosure?: { url?: string; type?: string }
  itunes?: { image?: string }
}

/** An item that survived the link filter, so `link` is no longer optional. */
export type LinkedRssItem = RssItem & { link: string }

export type IngestResult = {
  inserted: number
  /** Already in the database. */
  skipped: number
  /** Individually rejected by the database; the rest of the batch still landed. */
  failed: number
}

/** How many items we will scrape an og:image for, and how many at a time. */
const MAX_IMAGE_LOOKUPS = 40
const IMAGE_CONCURRENCY = 5
const IMAGE_TIMEOUT_MS = 2_000
const FEED_TIMEOUT_MS = 15_000
/** How far back an ingest reaches. Callers of `fetchFeedItems` may differ. */
const INGEST_WINDOW_DAYS = 30

/**
 * Items worth inserting: not already stored, and not a repeat of one earlier in
 * the same batch.
 *
 * The second half is the part that is easy to miss. Filtering only against what
 * is already in the database lets a feed that lists the same link twice (an
 * updated post re-published, or a paginated feed overlapping itself) insert it
 * twice, because both copies pass the check before either is written. There is
 * no unique constraint on (feed_id, link) to catch it afterwards, so the
 * duplicates persist and an agent reading the feed sees the same article twice.
 */
export function selectFreshItems<T extends { link: string }>(
  items: Array<T>,
  existing: Set<string>,
): Array<T> {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (existing.has(item.link) || seen.has(item.link)) return false
    seen.add(item.link)
    return true
  })
}

/** Runs `worker` over `items` with at most `limit` in flight at once. */
async function mapWithConcurrency<TItem, TResult>(
  items: Array<TItem>,
  limit: number,
  worker: (item: TItem, index: number) => Promise<TResult>,
): Promise<Array<TResult>> {
  const results = new Array<TResult>(items.length)
  let cursor = 0

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  })

  await Promise.all(runners)
  return results
}

/**
 * The image a feed hands us directly, with no extra request.
 *
 * Split out from `findImage` so callers that must not make 40 extra HTTP
 * requests — the Discover preview, notably — can still get an image. Order is
 * roughly best-quality-first: `media:content` is usually the full-size asset
 * while `media:thumbnail` is, as named, a thumbnail.
 */
export function feedImageOf(item: RssItem): string | null {
  return (
    item.mediaContent?.$?.url ??
    (item.enclosure?.type?.startsWith("image") ? item.enclosure.url : undefined) ??
    item.itunes?.image ??
    item.mediaThumbnail?.$?.url ??
    null
  )
}

/**
 * The best image for an article, scraping the page if the feed has none.
 *
 * og:image is tried FIRST and the feed's own fields are only the fallback —
 * that order is the whole point. Plenty of feeds ship a site-wide logo in
 * `media:thumbnail`, so preferring the feed's field would quietly replace real
 * article imagery with the same logo on every card.
 */
async function findImage(item: RssItem): Promise<string | null> {
  if (item.link) {
    try {
      const { text: html } = await safeFetchText(item.link, {
        timeoutMs: IMAGE_TIMEOUT_MS,
        maxBytes: 1024 * 1024,
      })
      const match =
        html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i) ??
        html.match(/content="([^"]+)"[^>]+property="og:image"/i) ??
        html.match(/<meta[^>]+name="twitter:image"[^>]+content="([^"]+)"/i)
      if (match?.[1]) return match[1]
    } catch {
      // Image lookup is best-effort.
    }
  }

  return feedImageOf(item)
}

/**
 * Fetches a feed and returns the items worth looking at, touching no database.
 *
 * The cut between this and `ingestFeed` is deliberately placed *before* any
 * image work. Returning an image from here would have meant ingest either
 * losing its og:image scrape or doing image lookups for items it was about to
 * discard as duplicates.
 */
export async function fetchFeedItems(
  url: string,
  {
    withinDays,
    timeoutMs = FEED_TIMEOUT_MS,
  }: {
    /** Omit for no age limit — take whatever the feed lists. */
    withinDays?: number
    timeoutMs?: number
  } = {},
): Promise<Array<LinkedRssItem>> {
  const parser = new Parser<object, RssItem>({
    customFields: {
      item: [
        ["media:content", "mediaContent", { keepArray: false }],
        ["media:thumbnail", "mediaThumbnail", { keepArray: false }],
        ["enclosure", "enclosure", { keepArray: false }],
        ["content:encoded", "contentEncoded", { keepArray: false }],
      ],
    },
  })

  const { res, text: xml, contentType } = await safeFetchText(url, { timeoutMs })
  if (!res.ok) throw new Error(`Failed to fetch feed: ${res.status}`)
  if (!looksLikeFeedContentType(contentType)) {
    throw new Error(`Expected a feed but got ${contentType || "an unknown content type"}`)
  }

  const feed = await parser.parseString(xml)

  const all = feed.items ?? []
  const cutoff = withinDays === undefined ? null : Date.now() - withinDays * 86_400_000
  const recent =
    cutoff === null
      ? all
      : all.filter((item) => {
          const iso = safeParseDate(item.isoDate || item.pubDate)
          if (!iso) return true // undated items are kept rather than silently dropped
          return new Date(iso).getTime() >= cutoff
        })

  const withLinks: Array<LinkedRssItem> = []
  for (const item of recent) {
    if (item.link) withLinks.push({ ...item, link: item.link })
  }
  return withLinks
}

/**
 * Stamps the outcome of a fetch onto the feed row.
 *
 * Best effort: a health write must never be the reason an ingest fails. Errors
 * used to go to console.error and nowhere else, which meant a feed that had
 * been 404ing for a month looked exactly like one that had not published.
 */
export async function recordFeedHealth(feedId: string, error: unknown | null) {
  try {
    const now = new Date().toISOString()
    await db
      .update(feeds)
      .set(
        error
          ? {
              lastError: String(error instanceof Error ? error.message : error).slice(0, 500),
              lastErrorAt: now,
            }
          : { lastFetchedAt: now, lastError: null, lastErrorAt: null },
      )
      .where(eq(feeds.id, feedId))
  } catch (err) {
    console.error("[rss] Failed to record feed health:", err)
  }
}

export async function fetchAndInsertArticles(feedId: string, url: string): Promise<IngestResult> {
  try {
    const result = await ingestFeed(feedId, url)
    await recordFeedHealth(feedId, null)
    return result
  } catch (err) {
    await recordFeedHealth(feedId, err)
    throw err
  }
}

async function ingestFeed(feedId: string, url: string): Promise<IngestResult> {
  const withLinks = await fetchFeedItems(url, { withinDays: INGEST_WINDOW_DAYS })

  if (withLinks.length === 0) return { inserted: 0, skipped: 0, failed: 0 }

  // One query for the whole batch instead of a SELECT per item.
  const links = [...new Set(withLinks.map((i) => i.link))]
  const existingRows = await db
    .select({ link: articles.link })
    .from(articles)
    .where(and(eq(articles.feedId, feedId), inArray(articles.link, links)))
  const existing = new Set(existingRows.map((r) => r.link))

  const fresh = selectFreshItems(withLinks, existing)
  const skipped = withLinks.length - fresh.length

  const images = await mapWithConcurrency(
    fresh.slice(0, MAX_IMAGE_LOOKUPS),
    IMAGE_CONCURRENCY,
    (item) => findImage(item),
  )

  let inserted = 0
  let failed = 0

  for (const [index, item] of fresh.entries()) {
    // Many feeds ship the full article body in <content:encoded>. Capture and
    // sanitize it now (free full-content) so the reader preview needs no fetch.
    const fullHtml = item.contentEncoded ? sanitizeArticleHtml(item.contentEncoded, item.link) : null

    try {
      await db.insert(articles).values({
        id: randomUUID(),
        feedId,
        title: decodeEntities(item.title?.trim() || "") || "Untitled",
        description: decodeEntities(item.contentSnippet ?? item.summary ?? "") || null,
        content: fullHtml,
        contentFetchedAt: fullHtml ? new Date().toISOString() : null,
        link: item.link,
        image: images[index] ?? null,
        publishedAt: safeParseDate(item.isoDate || item.pubDate),
      })
      inserted++
    } catch (err) {
      // One malformed row must not cost us the rest of the feed.
      failed++
      console.error(`[rss] Failed to insert article ${item.link}:`, err)
    }
  }

  return { inserted, skipped, failed }
}
