import { parseHTML } from "linkedom"
import { safeFetchText } from "./fetch"
import { extractPageLinks } from "./page-feed"
import {
  extractPublishedAt,
  extractReadable,
  extractSocialImage,
} from "./extract"
import { mapWithConcurrency } from "./concurrency"
import { safeParseDate } from "./dates"
import { emptySignals } from "./feed-signals"
import type { PageLink } from "./page-feed"

const ARTICLE_TIMEOUT_MS = 10_000
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
export async function readArticle(item: PageLink): Promise<FetchedArticle> {
  const fallback: FetchedArticle = {
    link: item.url,
    title: item.title,
    description: null,
    content: null,
    image: item.image ?? null,
    publishedAt: item.publishedAt,
  }

  try {
    const { res, text, finalUrl } = await safeFetchText(item.url, {
      timeoutMs: ARTICLE_TIMEOUT_MS,
      maxBytes: ARTICLE_MAX_BYTES,
    })
    if (!res.ok) return fallback

    const base = finalUrl || item.url
    const document = parseHTML(text).document
    fallback.image = extractSocialImage(text, base) ?? fallback.image
    fallback.publishedAt = extractPublishedAt(document) ?? fallback.publishedAt
    const readable = extractReadable(text, base)
    if (!readable || readable.length < 200) return fallback

    return {
      link: item.url,
      title:
        item.from === "slug" ||
        /^(research|open source|computer vision|news|blog|featured|updates)$/i.test(
          item.title
        )
          ? readable.title || item.title
          : item.title,
      description: readable.excerpt,
      content: readable.contentHtml,
      image: readable.image ?? fallback.image,
      // The article page states its date; the listing at best implied one.
      publishedAt: readable.publishedAt ?? item.publishedAt,
    }
  } catch {
    return fallback
  }
}

/** Shared website check for Add, Spark AI and Discover. No database side effects. */
export async function inspectWebsite(url: string) {
  const { res, text, finalUrl } = await safeFetchText(url, {
    timeoutMs: 15_000,
  })
  if (!res.ok) throw new Error(`That page returned ${res.status}.`)
  const base = finalUrl || url
  const links = extractPageLinks(text, base)
  if (links.length < 3) return null
  const sample = await mapWithConcurrency(links.slice(0, 4), 2, readArticle)
  const dates = [
    ...links.map((i) => safeParseDate(i.publishedAt)),
    ...sample.map((i) => safeParseDate(i.publishedAt)),
  ]
    .filter((d): d is string => !!d)
    .sort()
  const lastPublishedAt = dates.at(-1) ?? null
  const days = lastPublishedAt
    ? Math.max(0, (Date.now() - Date.parse(lastPublishedAt)) / 86_400_000)
    : null
  const signals = {
    ...emptySignals(base),
    itemCount: links.length,
    lastPublishedAt,
    daysSinceLastPost: days,
    freshness:
      days === null
        ? ("unknown" as const)
        : days <= 14
          ? ("fresh" as const)
          : days <= 60
            ? ("slow" as const)
            : ("quiet" as const),
  }
  if (sample.some((i) => !i.content)) signals.codes.push("summary_only")
  if (signals.freshness === "quiet") signals.codes.push("quiet")
  return {
    url: base,
    title:
      parseHTML(text).document.querySelector("title")?.textContent?.trim() ||
      new URL(base).hostname,
    itemCount: links.length,
    sampleTitles: sample.map((i) => i.title),
    signals,
    quality: sample.every((i) => !!i.content)
      ? ("readable" as const)
      : ("partial" as const),
    articles: sample,
  }
}
