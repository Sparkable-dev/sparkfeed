import { randomUUID } from "node:crypto"
import { and, eq, inArray } from "drizzle-orm"
import { safeFetchText } from "./fetch"
import { extractPageLinks } from "./page-feed"
import { extractReadable } from "./extract"
import { mapWithConcurrency } from "./concurrency"
import { recordFeedHealth, selectFreshItems } from "./fetch-articles"
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
    const { res, text } = await safeFetchText(item.url, {
      timeoutMs: ARTICLE_TIMEOUT_MS,
      maxBytes: ARTICLE_MAX_BYTES,
    })
    if (!res.ok) return fallback

    const readable = extractReadable(text, item.url)
    if (!readable) return fallback

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
export async function fetchPageArticles(feedId: string, pageUrl: string): Promise<IngestResult> {
  const { res, text } = await safeFetchText(pageUrl, { timeoutMs: LISTING_TIMEOUT_MS })
  if (!res.ok) throw new Error(`That page returned ${res.status}.`)

  const found = extractPageLinks(text, pageUrl)
  if (found.length === 0) {
    throw new Error("No posts found on that page. Its layout may have changed.")
  }

  const links = [...new Set(found.map((item) => item.url))]
  const existingRows = await db
    .select({ link: articles.link })
    .from(articles)
    .where(and(eq(articles.feedId, feedId), inArray(articles.link, links)))
  const existing = new Set(existingRows.map((r) => r.link))

  const fresh = selectFreshItems(
    found.map((item) => ({ ...item, link: item.url })),
    existing,
  )
  const skipped = found.length - fresh.length
  if (fresh.length === 0) return { inserted: 0, skipped, failed: 0 }

  const batch = fresh.slice(0, MAX_NEW_PER_RUN)
  const fetched = await mapWithConcurrency(batch, ARTICLE_CONCURRENCY, readArticle)

  let inserted = 0
  let failed = 0
  for (const article of fetched) {
    try {
      await db.insert(articles).values({
        id: randomUUID(),
        feedId,
        title: article.title.slice(0, 500) || "Untitled",
        description: article.description,
        content: article.content,
        contentFetchedAt: article.content ? new Date().toISOString() : null,
        link: article.link,
        image: article.image,
        publishedAt: article.publishedAt,
      })
      inserted++
    } catch (err) {
      // One bad row must not cost the rest of the page.
      failed++
      console.error(`[page-ingest] Failed to insert ${article.link}:`, err)
    }
  }

  // Anything past the cap is not lost, only deferred — it is still on the page
  // next time, and will be fresh then too.
  return { inserted, skipped: skipped + (fresh.length - batch.length), failed }
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
  kind: string | null,
): Promise<IngestResult> {
  if (kind !== "page") {
    const { fetchAndInsertArticles } = await import("./fetch-articles")
    return fetchAndInsertArticles(feedId, url)
  }

  try {
    const result = await fetchPageArticles(feedId, url)
    await recordFeedHealth(feedId, null)
    return result
  } catch (err) {
    await recordFeedHealth(feedId, err)
    throw err
  }
}
