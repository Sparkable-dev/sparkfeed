import { randomUUID } from "node:crypto"
import { and, asc, eq, inArray, isNull } from "drizzle-orm"
import { inspectWebsite, readArticle } from "./website-preview"
import { safeFetchText } from "./fetch"
import { extractPageLinks, nextListingPage } from "./page-feed"
import { acceptFeedReaderContent } from "./extract"
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
/** An article page is text; anything larger is not one. */

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
  pageUrl: string,
  options: { archive?: boolean; startUrl?: string } = {}
): Promise<IngestResult> {
  const listing = await collectPageArticles(
    options.startUrl || pageUrl,
    options.archive ? 5 : 1
  )
  const found = listing.items

  const links = [
    ...new Set(
      found.flatMap((item) => [
        item.url,
        `${item.url.replace(/\/+$/, "")}/`,
        item.url.replace(/\/+$/, ""),
      ])
    ),
  ]
  const existingRows = await db
    .select({
      id: articles.id,
      link: articles.link,
      content: articles.content,
      title: articles.title,
      fetchedAt: articles.contentFetchedAt,
      errorAt: articles.contentErrorAt,
      publishedAt: articles.publishedAt,
    })
    .from(articles)
    .where(and(eq(articles.feedId, feedId), inArray(articles.link, links)))
  // Archive links can rotate out of the listing before their bodies are read.
  const backlog = await db
    .select({
      id: articles.id,
      link: articles.link,
      content: articles.content,
      title: articles.title,
      fetchedAt: articles.contentFetchedAt,
      errorAt: articles.contentErrorAt,
      publishedAt: articles.publishedAt,
    })
    .from(articles)
    .where(and(eq(articles.feedId, feedId), isNull(articles.content)))
    .orderBy(asc(articles.contentErrorAt))
    .limit(MAX_NEW_PER_RUN)
  for (const row of backlog)
    if (!existingRows.some((existing) => existing.id === row.id))
      existingRows.push(row)
  const key = (url: string) => url.replace(/\/+$/, "")
  const existing = new Set(existingRows.map((r) => key(r.link)))
  const byUrl = new Map(found.map((item) => [key(item.url), item]))
  for (const row of existingRows) {
    const item = byUrl.get(key(row.link))
    if (
      item &&
      item.from !== "slug" &&
      item.title.length >= 16 &&
      item.title !== row.title
    )
      await db
        .update(articles)
        .set({ title: item.title.slice(0, 500) })
        .where(and(eq(articles.id, row.id), eq(articles.feedId, feedId)))
    const publishedAt = safeParseDate(byUrl.get(key(row.link))?.publishedAt)
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
    found.map((item) => ({ ...item, link: key(item.url) })),
    existing
  )
  const skipped = found.length - fresh.length

  const newBudget = existingRows.some((r) => !r.content)
    ? MAX_NEW_PER_RUN - 4
    : MAX_NEW_PER_RUN
  const batch = fresh.slice(0, newBudget)
  const fetched = await mapWithConcurrency(
    batch,
    ARTICLE_CONCURRENCY,
    readArticle
  )
  const attempted = new Set(batch.map((item) => item.link))
  // Persist every discovered link now; a busy listing can rotate before the next refresh.
  // Bodies beyond the per-run budget are fetched when opened, or on a later refresh.
  fetched.push(
    ...fresh.slice(newBudget).map((item) => ({
      link: item.link,
      title: item.title,
      description: null,
      content: null,
      image: item.image ?? null,
      publishedAt: item.publishedAt,
    }))
  )

  // Title-only rows must not permanently suppress a later successful extraction.
  const retry = existingRows
    .filter(
      (r) =>
        (!r.content ||
          !r.fetchedAt ||
          Date.now() - Date.parse(r.fetchedAt) > 7 * 86_400_000) &&
        (!r.errorAt || Date.now() - Date.parse(r.errorAt) > 60 * 60_000)
    )
    .slice(0, Math.max(0, MAX_NEW_PER_RUN - batch.length))
  await mapWithConcurrency(retry, ARTICLE_CONCURRENCY, async (row) => {
    const item = byUrl.get(key(row.link)) ?? {
      url: row.link,
      title: row.title,
      publishedAt: row.publishedAt,
      from: "link-text" as const,
    }
    const article = await readArticle(item)
    await db
      .update(articles)
      .set({
        ...(article.content
          ? {
              content:
                acceptFeedReaderContent(article.content, row.content) ??
                row.content,
              contentFetchedAt: new Date().toISOString(),
              contentSource: "extracted",
              ...(article.image ? { image: article.image } : {}),
              ...(article.description
                ? { description: article.description }
                : {}),
            }
          : {}),
        ...(article.title && (item.from !== "slug" || article.content)
          ? { title: article.title.slice(0, 500) }
          : {}),
        ...(!row.publishedAt && safeParseDate(article.publishedAt)
          ? { publishedAt: safeParseDate(article.publishedAt) }
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
            article.content || !attempted.has(key(article.link))
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

  return {
    inserted,
    skipped,
    failed,
    ...(options.archive
      ? {
          archive: {
            pages: listing.pages,
            nextUrl: listing.nextUrl,
            reason: listing.reason,
          },
        }
      : {}),
  }
}

/** Bounded traversal of publisher-provided pagination. All requests retain SSRF checks. */
export async function collectPageArticles(startUrl: string, maxPages = 1) {
  const items: Array<PageLink> = []
  const seen = new Set<string>()
  const visited = new Set<string>()
  const started = Date.now()
  let nextUrl: string | null = startUrl
  let pages = 0
  let reason =
    "No further HTML pagination found. JavaScript-only archives may need a browser."
  while (nextUrl && pages < Math.min(maxPages, 5) && items.length < 160) {
    if (Date.now() - started >= 45_000) {
      reason = "Time limit reached. Continue to fetch more."
      break
    }
    if (visited.has(nextUrl)) {
      nextUrl = null
      reason = "Stopped a repeated pagination link."
      break
    }
    visited.add(nextUrl)
    const current = nextUrl
    try {
      const { res, text, finalUrl } = await safeFetchText(current, {
        timeoutMs: Math.min(
          LISTING_TIMEOUT_MS,
          45_000 - (Date.now() - started)
        ),
      })
      if (!res.ok) throw new Error(`That page returned ${res.status}.`)
      const base = finalUrl || current
      if (new URL(base).origin !== new URL(startUrl).origin)
        throw new Error("Archive redirected to another site.")
      const found = extractPageLinks(text, base)
      if (!found.length)
        throw new Error(
          "No posts found on that page. Its layout may have changed."
        )
      const fresh = found.filter(
        (item) => !seen.has(item.url.replace(/\/+$/, ""))
      )
      for (const item of fresh) {
        seen.add(item.url.replace(/\/+$/, ""))
        items.push(item)
      }
      pages++
      nextUrl = nextListingPage(text, base)
      if (!fresh.length) {
        nextUrl = null
        reason = "Stopped because the page repeated articles already found."
        break
      }
    } catch (error) {
      if (!items.length) throw error
      reason = `Some archive pages could not be read. ${error instanceof Error ? error.message : "Try again later."}`
      break
    }
  }
  if (nextUrl && !reason.startsWith("Some"))
    reason = "Batch limit reached. Continue to fetch more."
  return { items, pages, nextUrl, reason }
}

/** A small preview uses the same extraction path as an imported website. */
export async function fetchPagePreview(url: string) {
  const result = await inspectWebsite(url)
  if (!result)
    throw new Error("No posts found on that page. Its layout may have changed.")
  return result.articles
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
  options: { archive?: boolean; startUrl?: string } = {}
): Promise<IngestResult> {
  if (kind !== "page") {
    const { fetchAndInsertArticles } = await import("./fetch-articles")
    return fetchAndInsertArticles(feedId, url)
  }

  const { canIngestFeed } = await import("@/server/entitlements/ingestion")
  if (!(await canIngestFeed(feedId)))
    return { inserted: 0, skipped: 1, failed: 0 }

  try {
    const result = await fetchPageArticles(feedId, url, options)
    await recordFeedHealth(feedId, null)
    return result
  } catch (err) {
    await recordFeedHealth(feedId, err)
    throw err
  }
}
