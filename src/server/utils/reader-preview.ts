import {
  articleText,
  checkCanEmbed,
  extractReadable,
  hasCurrentReaderExtraction,
  readerContentEndsAtHeading,
  sanitizeArticleHtml,
} from "./extract"
import { safeFetchText } from "./fetch"
import { publisherAmpUrl, publisherFeedContent } from "./publisher-content"

interface SavedReaderArticle {
  feedUrl?: string | null
  link: string
  content: string | null
  description: string | null
  contentSource: string | null
  contentErrorAt: string | null
}

interface ReaderCacheUpdate {
  content?: string
  contentFetchedAt?: string
  contentSource?: string
  contentErrorAt: string | null
}

/** Called only after the article has been resolved within the current workspace. */
export async function loadReaderPreview(article: SavedReaderArticle) {
  let readerHtml = article.content
  let canEmbed = false
  let quality = readerHtml ? (article.contentSource ?? "saved") : "summary"
  let notice: "blocked" | "unavailable" | "partial" | null = null
  let cacheUpdate: ReaderCacheUpdate | null = null
  const savedText = readerHtml ? articleText(readerHtml) : ""
  const summaryText = article.description
    ? articleText(article.description)
    : ""
  const incomplete =
    !!readerHtml &&
    (readerContentEndsAtHeading(readerHtml) ||
      (article.contentSource === "extracted" &&
        !hasCurrentReaderExtraction(readerHtml)) ||
      (article.contentSource === "feed" &&
        !!summaryText &&
        savedText === summaryText))
  if (
    readerHtml &&
    article.contentSource === "feed" &&
    savedText === summaryText
  )
    quality = "summary"
  const errorTime = Date.parse(article.contentErrorAt ?? "")
  const retryAllowed =
    !Number.isFinite(errorTime) || Date.now() - errorTime > 15 * 60_000

  if ((!readerHtml || incomplete) && retryAllowed) {
    let candidate: { html: string; source: string } | null = null
    const consider = (html: string, source: string) => {
      const text = articleText(html)
      // A publisher's teaser must not be cached as a successfully recovered body.
      if (
        text.length < 80 ||
        (summaryText &&
          text.length <= summaryText.length &&
          summaryText.includes(text))
      )
        return
      if (
        savedText &&
        (text.length < savedText.length || readerContentEndsAtHeading(html))
      )
        return
      const partial = readerContentEndsAtHeading(html)
      const previousPartial =
        candidate && readerContentEndsAtHeading(candidate.html)
      if (
        !candidate ||
        (previousPartial && !partial) ||
        (previousPartial === partial &&
          text.length > articleText(candidate.html).length)
      ) {
        candidate = { html, source }
      }
    }
    let alternate: string | null = null
    try {
      const { res, text, finalUrl } = await safeFetchText(article.link, {
        timeoutMs: 8000,
      })
      if (res.ok) {
        const baseUrl = finalUrl || article.link
        canEmbed = checkCanEmbed(res.headers)
        alternate = publisherAmpUrl(text, baseUrl)
        const extracted = extractReadable(text, baseUrl)
        if (extracted) consider(extracted.contentHtml, "extracted")
      } else {
        notice =
          res.status === 401 || res.status === 403 ? "blocked" : "unavailable"
      }
    } catch {
      notice = "unavailable"
    }
    const needsRecovery = () =>
      !candidate || readerContentEndsAtHeading(candidate.html)
    if (needsRecovery() && alternate) {
      try {
        const { res, text, finalUrl } = await safeFetchText(alternate, {
          timeoutMs: 5000,
        })
        if (res.ok) {
          const extracted = extractReadable(text, finalUrl || alternate)
          if (extracted) consider(extracted.contentHtml, "extracted")
        }
      } catch {
        /* Keep the available article when an alternative fails. */
      }
    }
    if (needsRecovery() && article.feedUrl) {
      try {
        const html = await publisherFeedContent(article.feedUrl, article.link)
        if (html) consider(html, "feed")
      } catch {
        /* Malformed feeds must not discard saved text. */
      }
    }
    // The callback above assigns this candidate after each independently fallible fetch.
    const recovered = candidate as { html: string; source: string } | null
    if (recovered) {
      readerHtml = recovered.html
      quality = recovered.source
      const partial = readerContentEndsAtHeading(readerHtml)
      notice = partial ? "partial" : null
      cacheUpdate = {
        content: readerHtml,
        contentFetchedAt: new Date().toISOString(),
        contentSource: quality,
        contentErrorAt: partial ? new Date().toISOString() : null,
      }
    } else {
      notice ??= "unavailable"
      cacheUpdate = { contentErrorAt: new Date().toISOString() }
    }
  }
  if (!readerHtml && article.description) {
    readerHtml = sanitizeArticleHtml(article.description, article.link)
    quality = "summary"
    notice ??= "unavailable"
  }
  if (readerHtml && readerContentEndsAtHeading(readerHtml)) notice = "partial"
  return {
    readerHtml,
    canEmbed,
    quality: readerHtml ? quality : "unavailable",
    notice,
    cacheUpdate,
  }
}
