import { randomUUID } from "node:crypto"
import { and, eq, inArray, or } from "drizzle-orm"
import { parseSyndication } from "./parse-feed"
import { safeFetchText } from "./fetch"
import { safeParseDate } from "./dates"
import { acceptFeedReaderContent, extractSocialImage, sanitizeArticleHtml } from "./extract"
import { decodeEntities } from "./entities"
import { mapWithConcurrency } from "./concurrency"
import type { FeedItem } from "./parse-feed"
import { articles, feeds } from "@/db/schema"
import { db } from "@/db/index"

export { safeParseDate }

/** An item that survived the link filter, so `link` is no longer optional. */
export type LinkedFeedItem = FeedItem & { link: string }

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
/** Deliberately bounded recent-feed import, not complete publisher history. */
const MAX_INGEST_ITEMS = 100

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
  existing: Set<string>
): Array<T> {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (existing.has(item.link) || seen.has(item.link)) return false
    seen.add(item.link)
    return true
  })
}

/**
 * The image a feed hands us directly, with no extra request.
 *
 * Split out from `findImage` so callers that must not make 40 extra HTTP
 * requests — the Discover preview, notably — can still get an image. Order is
 * roughly best-quality-first: `media:content` is usually the full-size asset
 * while `media:thumbnail` is, as named, a thumbnail.
 */
export function feedImageOf(item: FeedItem): string | null {
  return item.image ?? null
}

/**
 * The best image for an article, scraping the page if the feed has none.
 *
 * og:image is tried FIRST and the feed's own fields are only the fallback —
 * that order is the whole point. Plenty of feeds ship a site-wide logo in
 * `media:thumbnail`, so preferring the feed's field would quietly replace real
 * article imagery with the same logo on every card.
 */
async function findImage(item: FeedItem): Promise<string | null> {
  if (item.link) {
    try {
      const {
        res,
        text: html,
        finalUrl,
      } = await safeFetchText(item.link, {
        timeoutMs: IMAGE_TIMEOUT_MS,
        maxBytes: 1024 * 1024,
      })
      if (res.ok) {
        const image = extractSocialImage(html, finalUrl || item.link)
        if (image) return image
      }
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
  } = {}
): Promise<Array<LinkedFeedItem>> {
  const { res, text: xml, finalUrl } = await safeFetchText(url, { timeoutMs })
  if (!res.ok) throw new Error(`Failed to fetch feed: ${res.status}`)
  const feed = parseSyndication(
    xml,
    finalUrl && /^https?:/.test(finalUrl) ? finalUrl : url
  )

  const all = feed.items ?? []
  const cutoff =
    withinDays === undefined ? null : Date.now() - withinDays * 86_400_000
  const recent =
    cutoff === null
      ? all
      : all.filter((item) => {
          const iso = safeParseDate(item.isoDate || item.pubDate)
          if (!iso) return true // undated items are kept rather than silently dropped
          return new Date(iso).getTime() >= cutoff
        })

  const withLinks: Array<LinkedFeedItem> = []
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
              lastError: String(
                error instanceof Error ? error.message : error
              ).slice(0, 500),
              lastErrorAt: now,
            }
          : { lastFetchedAt: now, lastError: null, lastErrorAt: null }
      )
      .where(eq(feeds.id, feedId))
  } catch (err) {
    console.error("[rss] Failed to record feed health:", err)
  }
}

export async function fetchAndInsertArticles(
  feedId: string,
  url: string
): Promise<IngestResult> {
  const { canIngestFeed } = await import("@/server/entitlements/ingestion")
  if (!(await canIngestFeed(feedId)))
    return { inserted: 0, skipped: 1, failed: 0 }
  try {
    const [state] = await db
      .select({ etag: feeds.httpEtag, modified: feeds.httpLastModified })
      .from(feeds)
      .where(eq(feeds.id, feedId))
      .limit(1)
    const headers: Record<string, string> = {
      Accept:
        "application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, */*;q=0.5",
    }
    if (state?.etag) headers["If-None-Match"] = state.etag
    if (state?.modified) headers["If-Modified-Since"] = state.modified
    const response = await safeFetchText(url, {
      timeoutMs: FEED_TIMEOUT_MS,
      headers,
    })
    if (response.res.status === 304) {
      await recordFeedHealth(feedId, null)
      return { inserted: 0, skipped: 0, failed: 0 }
    }
    if (!response.res.ok)
      throw new Error(`Failed to fetch feed: ${response.res.status}`)
    const items = parseSyndication(
      response.text,
      response.finalUrl || url
    ).items
    const withLinks = items
      .flatMap((item) => {
        if (item.link)
          return [
            {
              ...item,
              sourceId: item.sourceId || `url:${item.link}`,
              link: item.link,
            },
          ]
        // Feed-only entries retain their identity and saved body without inventing an article URL.
        if (item.sourceId && item.contentEncoded)
          return [
            {
              ...item,
              link: `${response.finalUrl || url}#entry-${encodeURIComponent(item.sourceId)}`,
            },
          ]
        return []
      })
      .slice(0, MAX_INGEST_ITEMS)
    const result = await ingestFeed(feedId, withLinks)
    if (result.failed === 0) {
      await db
        .update(feeds)
        .set({
          httpEtag: response.res.headers.get("etag"),
          httpLastModified: response.res.headers.get("last-modified"),
        })
        .where(eq(feeds.id, feedId))
    }
    await recordFeedHealth(
      feedId,
      result.failed
        ? new Error(
            `${result.failed} articles could not be saved. Retry refresh.`
          )
        : null
    )
    return result
  } catch (err) {
    await recordFeedHealth(feedId, err)
    throw err
  }
}

async function ingestFeed(
  feedId: string,
  withLinks: Array<LinkedFeedItem>
): Promise<IngestResult> {
  if (withLinks.length === 0) return { inserted: 0, skipped: 0, failed: 0 }

  // One query for the whole batch instead of a SELECT per item.
  const links = [...new Set(withLinks.map((i) => i.link))]
  const sourceIds = withLinks.flatMap((i) => (i.sourceId ? [i.sourceId] : []))
  const existingRows = await db
    .select({
      id: articles.id,
      link: articles.link,
      sourceId: articles.sourceId,
      content: articles.content,
      contentSource: articles.contentSource,
      title: articles.title,
      description: articles.description,
      image: articles.image,
      publishedAt: articles.publishedAt,
      sourceUpdatedAt: articles.sourceUpdatedAt,
    })
    .from(articles)
    .where(
      and(
        eq(articles.feedId, feedId),
        or(
          inArray(articles.link, links),
          sourceIds.length ? inArray(articles.sourceId, sourceIds) : undefined
        )
      )
    )
  const byLink = new Map(existingRows.map((r) => [r.link, r]))
  const bySource = new Map(
    existingRows.flatMap((r) => (r.sourceId ? [[r.sourceId, r] as const] : []))
  )
  const seen = new Set<string>()
  let skipped = 0
  const enrich: Array<{ id: string; item: LinkedFeedItem }> = []
  const imageCounts = new Map<string, number>()
  for (const item of withLinks)
    if (item.image)
      imageCounts.set(item.image, (imageCounts.get(item.image) ?? 0) + 1)

  let inserted = 0
  let failed = 0

  for (const item of withLinks) {
    const key = item.sourceId ?? item.link
    if (seen.has(key)) {
      skipped++
      continue
    }
    seen.add(key)
    // Many feeds ship the full article body in <content:encoded>. Capture and
    // sanitize it now (free full-content) so the reader preview needs no fetch.
    const feedHtml = item.contentEncoded
      ? sanitizeArticleHtml(item.contentEncoded, item.link)
      : null

    try {
      const existing =
        (item.sourceId ? bySource.get(item.sourceId) : undefined) ??
        byLink.get(item.link)
      const fullHtml = acceptFeedReaderContent(feedHtml, existing?.content)
      const id = existing?.id ?? randomUUID()
      const values = {
        feedId,
        title: decodeEntities(item.title?.trim() || "") || "Untitled",
        description:
          decodeEntities(item.contentSnippet ?? item.summary ?? "") || null,
        content: fullHtml ?? existing?.content ?? null,
        contentFetchedAt: fullHtml ? new Date().toISOString() : null,
        contentSource: fullHtml ? "feed" : (existing?.contentSource ?? null),
        sourceId: item.sourceId ?? existing?.sourceId ?? null,
        sourceUpdatedAt: item.updatedAt ?? existing?.sourceUpdatedAt ?? null,
        link: item.link,
        image: feedImageOf(item),
        publishedAt:
          safeParseDate(item.isoDate || item.pubDate) ??
          existing?.publishedAt ??
          null,
      }
      if (existing) {
        // Never replace article IDs or user state when publisher metadata changes.
        const { image, contentFetchedAt, ...metadata } = values
        const changed =
          Object.entries(metadata).some(
            ([field, value]) =>
              field !== "feedId" &&
              existing[field as keyof typeof existing] !== value
          ) ||
          (!!image && image !== existing.image)
        if (changed)
          await db
            .update(articles)
            .set({
              ...metadata,
              ...(image ? { image } : {}),
              ...(fullHtml && fullHtml !== existing.content
                ? { contentFetchedAt }
                : {}),
            })
            .where(and(eq(articles.id, id), eq(articles.feedId, feedId)))
        skipped++
      } else {
        const added = await db
          .insert(articles)
          .values({ id, ...values })
          .onConflictDoNothing()
          .returning({ id: articles.id })
        if (added.length) {
          inserted++
          if (!values.image || (imageCounts.get(values.image) ?? 0) > 1)
            enrich.push({ id, item })
        } else skipped++
      }
    } catch (err) {
      // One malformed row must not cost us the rest of the feed.
      failed++
      console.error(`[rss] Failed to insert article ${item.link}:`, err)
    }
  }

  // Cards and refresh completion never wait on optional social images.
  void mapWithConcurrency(
    enrich.slice(0, MAX_IMAGE_LOOKUPS),
    IMAGE_CONCURRENCY,
    async ({ id, item }) => {
      const image = await findImage(item)
      if (image)
        await db
          .update(articles)
          .set({ image })
          .where(and(eq(articles.id, id), eq(articles.feedId, feedId)))
    }
  ).catch((error) => console.warn("[rss] Image enrichment failed", error))

  return { inserted, skipped, failed }
}
