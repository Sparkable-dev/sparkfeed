import { parseHTML } from "linkedom"
import { safeFetchText } from "./fetch"
import { parseSyndication } from "./parse-feed"
import { sanitizeArticleHtml } from "./extract"

/** Ignore fragments and analytics parameters, but retain article-identifying queries. */
export function publisherArticleKey(raw: string, base?: string) {
  try {
    const url = new URL(raw, base)
    if (!/^https?:$/.test(url.protocol) || url.username || url.password)
      return null
    url.hash = ""
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key)) url.searchParams.delete(key)
    }
    url.searchParams.sort()
    url.pathname = url.pathname.replace(/\/$/, "") || "/"
    return url.href
  } catch {
    return null
  }
}

/** Follow only an explicitly advertised, same-origin alternative. Never guess URLs. */
export function publisherAmpUrl(html: string, pageUrl: string) {
  const { document } = parseHTML(html)
  for (const link of document.querySelectorAll("link[rel][href]")) {
    if (
      !link.getAttribute("rel")?.toLowerCase().split(/\s+/).includes("amphtml")
    )
      continue
    const key = publisherArticleKey(link.getAttribute("href")!, pageUrl)
    if (
      key &&
      new URL(key).origin === new URL(pageUrl).origin &&
      key !== publisherArticleKey(pageUrl)
    )
      return key
  }
  return null
}

// Coalesce concurrent requests without retaining publishers' feed bodies in memory.
const pendingFeeds = new Map<string, ReturnType<typeof safeFetchText>>()

/** A full RSS/Atom/JSON entry is a valid alternative; a feed summary is not. */
export async function publisherFeedContent(
  feedUrl: string,
  articleUrl: string
) {
  const key = publisherArticleKey(articleUrl)
  if (!key || !publisherArticleKey(feedUrl)) return null
  let pending = pendingFeeds.get(feedUrl)
  if (!pending) {
    pending = safeFetchText(feedUrl, { timeoutMs: 5000 })
    pendingFeeds.set(feedUrl, pending)
  }
  try {
    const { res, text, finalUrl } = await pending
    if (!res.ok) return null
    const { items } = parseSyndication(text, finalUrl || feedUrl)
    const entry = items.find(
      (item) => item.link && publisherArticleKey(item.link) === key
    )
    return entry?.contentEncoded
      ? sanitizeArticleHtml(entry.contentEncoded, entry.link)
      : null
  } finally {
    if (pendingFeeds.get(feedUrl) === pending) pendingFeeds.delete(feedUrl)
  }
}
