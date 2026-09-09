import { randomUUID } from "node:crypto"
import { and, eq, inArray, isNull } from "drizzle-orm"
import { safeFetchText } from "./fetch"
import { extractPageLinks } from "./page-feed"
import { extractReadable } from "./extract"
import { mapWithConcurrency } from "./concurrency"
import {
  recordFeedHealth,
  safeParseDate,
  selectFreshItems,
} from "./fetch-articles"
import type { IngestResult } from "./fetch-articles"
import type { PageLink } from "./page-feed"
import { db } from "@/db/index"
import { articles } from "@/db/schema"

/**
 * Ingesting a site that has no feed, by reading its listing page.
 *
 * The counterpart to `fetch-articles.ts`, and deliberately the same shape: same
 * `IngestResult`, same dedupe rule, same health stamping, same per-row error
 * isolation. A watched page produces `articles` rows against a `feeds` row, so
 * everything downstream — the grid, search, the reader, favourites, the AI
 * tools — cannot tell the two apart, and does not need to.
 *
 * The one real difference is that a listing page carries almost nothing but
 * titles and links. A feed hands over a summary, a date and often the whole
 * post; a page has to be asked, one article at a time. So each new post is
 * fetched and run through Readability at ingest, which is what fills in the
 * body, the picture, the author and the date. That is also why the number of
 * new posts per run is capped: this is the only ingest path where the cost is
 * one request per article rather than one per source.
 */

/** Posts fetched in full per run. Beyond this, the rest wait for the next one. */
const MAX_NEW_PER_RUN = 12
/** Article pages fetched at once. Politeness as much as throughput. */
const ARTICLE_CONCURRENCY = 4
const LISTING_TIMEOUT_MS = 15_000
const ARTICLE_TIMEOUT_MS = 10_000
/** An article page is text; anything larger is not one. */
const ARTICLE_MAX_BYTES = 2 * 1024 * 1024

/** What one post looks like once its own page has been read. */
interface FetchedArticle {
  link: string
  title: string
  description: string | null
  content: string | null
  image: string | null
  publishedAt: string | null
}

/**
 * Reads one post's own page.
 *
 * Failure is not fatal and not even unusual — a post behind a cookie wall, a
 * JS-rendered page, a 404 from a stale listing. The link and the title from the
 * listing are already worth storing, so a failed read degrades to those rather
 * than dropping the post.
 */
async function readArticle(item: PageLink): Promise<FetchedArticle> {
  const fallback: FetchedArticle = {
    link: item.url,
    title: item.title,
    description: null,
    content: null,
    image: null,
    publishedAt: item.publishedAt,
  }

  try {
    const { res, text, finalUrl } = await safeFetchText(item.url, {
      timeoutMs: ARTICLE_TIMEOUT_MS,
      maxBytes: ARTICLE_MAX_BYTES,
    })
    if (!res.ok) return fallback

    const readable = extractReadable(text, finalUrl || item.url)
    if (!readable || readable.length < 200) return fallback

    return {
      link: item.url,
      /*
        The listing's title wins. It is what the site chose to show in its own
        index, whereas a page's <title> is usually the headline with " | Site
        Name" appended, and Readability takes it verbatim.
      */
      title: item.title || readable.title || item.url,
      description: readable.excerpt,
      content: readable.contentHtml,
      image: readable.image,
      // The article page states its date; the listing at best implied one.
      publishedAt: readable.publishedAt ?? item.publishedAt,
    }
  } catch {
    return fallback
  }
}

/**
 * Reads a listing page and stores whatever is new on it.
 *
 * Throws only on a failure of the *listing* — an unreachable page, or one we
 * can no longer find posts on. That second case matters: this is a heuristic
 * over someone else's markup, and a redesign turns it into a scrape that
 * silently succeeds with nothing. Reporting it as an error is what makes the
 * source show as broken on /sources instead of quietly going dead.
 */
export async function fetchPageArticles(
  feedId: string,
  pageUrl: string
): Promise<IngestResult> {
  const { res, text, finalUrl } = await safeFetchText(pageUrl, {
    timeoutMs: LISTING_TIMEOUT_MS,
  })
  if (!res.ok) throw new Error(`That page returned ${res.status}.`)

  const found = extractPageLinks(text, finalUrl || pageUrl)
  if (found.length === 0) {
    throw new Error("No posts found on that page. Its layout may have changed.")
  }

  const links = [...new Set(found.map((item) => item.url))]
  const existingRows = await db
    .select({
      id: articles.id,
      link: articles.link,
      content: articles.content,
      errorAt: articles.contentErrorAt,
      publishedAt: articles.publishedAt,
    })
    .from(articles)
    .where(and(eq(articles.feedId, feedId), inArray(articles.link, links)))
  const existing = new Set(existingRows.map((r) => r.link))
  for (const row of existingRows) {
    const publishedAt = safeParseDate(
      found.find((item) => item.url === row.link)?.publishedAt
    )
    if (!row.publishedAt && publishedAt)
      await db
        .update(articles)
        .set({ publishedAt })
        .where(
          and(
            eq(articles.id, row.id),
            eq(articles.feedId, feedId),
            isNull(articles.publishedAt)
          )
        )
  }

  const fresh = selectFreshItems(
    found.map((item) => ({ ...item, link: item.url })),
    existing
  )
  const skipped = found.length - fresh.length

  const batch = fresh.slice(0, MAX_NEW_PER_RUN)
  const fetched = await mapWithConcurrency(
    batch,
    ARTICLE_CONCURRENCY,
    readArticle
  )
  const attempted = new Set(batch.map((item) => item.link))
  // Persist every discovered link now; a busy listing can rotate before the next refresh.
  // Bodies beyond the per-run budget are fetched when opened, or on a later refresh.
  fetched.push(
    ...fresh.slice(MAX_NEW_PER_RUN).map((item) => ({
      link: item.link,
      title: item.title,
      description: null,
      content: null,
      image: null,
      publishedAt: item.publishedAt,
    }))
  )

  // Title-only rows must not permanently suppress a later successful extraction.
  const retry = existingRows
    .filter(
      (r) =>
        !r.content &&
        (!r.errorAt || Date.now() - Date.parse(r.errorAt) > 60 * 60_000)
    )
    .slice(0, Math.max(0, MAX_NEW_PER_RUN - batch.length))
  await mapWithConcurrency(retry, ARTICLE_CONCURRENCY, async (row) => {
    const item = found.find((i) => i.url === row.link)
    if (!item) return
    const article = await readArticle(item)
    await db
      .update(articles)
      .set({
        ...(article.content
          ? {
              content: article.content,
              contentFetchedAt: new Date().toISOString(),
              contentSource: "extracted",
              image: article.image,
              description: article.description,
            }
          : {}),
        contentErrorAt: article.content ? null : new Date().toISOString(),
      })
      .where(and(eq(articles.id, row.id), eq(articles.feedId, feedId)))
  })

  let inserted = 0
  let failed = 0
  // Insert oldest-listed first so undated items retain the publisher's order when sorted by arrival.
  for (const article of [...fetched].reverse()) {
    try {
      const saved = await db
        .insert(articles)
        .values({
          id: randomUUID(),
          feedId,
          title: article.title.slice(0, 500) || "Untitled",
          description: article.description,
          content: article.content,
          contentFetchedAt: article.content ? new Date().toISOString() : null,
          contentSource: article.content ? "extracted" : null,
          contentErrorAt:
            article.content || !attempted.has(article.link)
              ? null
              : new Date().toISOString(),
          sourceId: `url:${article.link}`,
          link: article.link,
          image: article.image,
          publishedAt: safeParseDate(article.publishedAt),
        })
        .onConflictDoNothing()
        .returning({ id: articles.id })
      inserted += saved.length
    } catch (err) {
      // One bad row must not cost the rest of the page.
      failed++
      console.error(`[page-ingest] Failed to insert ${article.link}:`, err)
    }
  }

  return { inserted, skipped, failed }
}

/** A small preview uses the same extraction path as an imported website. */
export async function fetchPagePreview(url: string) {
  const { res, text, finalUrl } = await safeFetchText(url, {
    timeoutMs: LISTING_TIMEOUT_MS,
  })
  if (!res.ok) throw new Error(`That page returned ${res.status}.`)
  const found = extractPageLinks(text, finalUrl || url)
  if (!found.length)
    throw new Error("No posts found on that page. Its layout may have changed.")
  return mapWithConcurrency(found.slice(0, 4), 2, readArticle)
}

/**
 * Ingests one source, whichever kind it is.
 *
 * The single place that branches on `feeds.kind`. Every caller — the queue, the
 * refresh buttons, the folder refresh — goes through here, so adding a third
 * kind later is one case in one function rather than a search of the codebase.
 */
export async function ingestSource(
  feedId: string,
  url: string,
  kind: string | null
): Promise<IngestResult> {
  if (kind !== "page") {
    const { fetchAndInsertArticles } = await import("./fetch-articles")
    return fetchAndInsertArticles(feedId, url)
  }

  const { canIngestFeed } = await import("@/server/entitlements/ingestion")
  if (!(await canIngestFeed(feedId)))
    return { inserted: 0, skipped: 1, failed: 0 }

  try {
    const result = await fetchPageArticles(feedId, url)
    await recordFeedHealth(feedId, null)
    return result
  } catch (err) {
    await recordFeedHealth(feedId, err)
    throw err
  }
}
