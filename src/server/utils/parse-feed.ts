import { parseFeed } from "feedsmith"
import { safeParseDate } from "./dates"
import { decodeEntities } from "./entities"
import type { Atom } from "feedsmith/types"

/** The only boundary that knows publisher-specific feed formats.
 * API: https://feedsmith.dev/parsing (pinned stable 2.x).
 */
export type FeedItem = {
  sourceId?: string
  link?: string
  title?: string
  content?: string
  contentEncoded?: string
  contentSnippet?: string
  summary?: string
  pubDate?: string
  isoDate?: string
  updatedAt?: string
  authors?: Array<string>
  image?: string
}

export function articleUrl(
  value: string | undefined,
  base?: string
): string | undefined {
  if (!value?.trim()) return undefined
  try {
    const url = new URL(value.trim(), base)
    if (!/^https?:$/.test(url.protocol) || url.username || url.password)
      return undefined
    return url.href
  } catch {
    return undefined
  }
}

function text(value?: string): string | undefined {
  return value
    ? decodeEntities(value.replace(/<[^>]*>/g, " "))
        .replace(/\s+/g, " ")
        .trim()
    : undefined
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function alternate(
  links?: Array<Partial<Atom.Link<string>>>
): string | undefined {
  return (
    links?.find(
      (l) =>
        (!l.rel || l.rel === "alternate") && (!l.type || /html/i.test(l.type))
    )?.href ?? links?.find((l) => !l.rel || l.rel === "alternate")?.href
  )
}

type ParsedRssItem = NonNullable<
  Extract<ReturnType<typeof parseFeed>, { format: "rss" }>["feed"]["items"]
>[number]
function mediaImage(media?: ParsedRssItem["media"]): string | undefined {
  const contents = [
    ...(media?.contents ?? []),
    ...(media?.groups ?? []).flatMap((g) => g.contents ?? []),
  ]
  return (
    contents.find((c) => c.medium === "image" || c.type?.startsWith("image/"))
      ?.url ??
    media?.thumbnails?.[0]?.url ??
    media?.groups?.flatMap((g) => g.thumbnails ?? [])[0]?.url
  )
}

export function parseSyndication(
  body: string,
  baseUrl?: string
): { title?: string; items: Array<FeedItem>; format: string } {
  // Reject DTDs instead of allowing untrusted entity expansion or external entities.
  if (
    body.trimStart().startsWith("<") &&
    /<!DOCTYPE|<!ENTITY/i.test(
      body.replace(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->/g, "")
    )
  )
    throw new Error("Invalid feed: DTDs are not supported")
  const parsed = parseFeed(body)
  const finish = (item: FeedItem): FeedItem => ({
    ...item,
    title: text(item.title),
    link: articleUrl(item.link, baseUrl),
    image: articleUrl(
      item.image ??
        item.content
          ?.slice(0, 32_768)
          .match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i)?.[1],
      articleUrl(item.link, baseUrl) ?? baseUrl
    ),
    isoDate: safeParseDate(item.pubDate) ?? undefined,
    updatedAt: safeParseDate(item.updatedAt) ?? undefined,
    // Cards need an excerpt, not a second normalized copy of a whole book-length body.
    contentSnippet: text((item.summary ?? item.content)?.slice(0, 8192))?.slice(
      0,
      2000
    ),
    contentEncoded: item.content,
  })
  switch (parsed.format) {
    case "rss":
      return {
        format: "rss",
        title: text(parsed.feed.title),
        items: (parsed.feed.items ?? []).map((i) =>
          finish({
            sourceId: i.guid?.value,
            link:
              i.link ??
              (i.guid?.isPermaLink !== false &&
              /^https?:\/\//i.test(i.guid?.value ?? "")
                ? i.guid?.value
                : undefined) ??
              alternate(i.atom?.links),
            title: i.title,
            content: i.content?.encoded,
            summary: i.description,
            pubDate: i.pubDate ?? i.dc?.date,
            updatedAt: i.atom?.updated,
            authors: i.authors ?? (i.dc?.creator ? [i.dc.creator] : []),
            image:
              mediaImage(i.media) ??
              i.enclosures?.find((e) => e.type?.startsWith("image/"))?.url ??
              i.itunes?.image,
          })
        ),
      }
    case "atom":
      return {
        format: "atom",
        title: text(parsed.feed.title),
        items: (parsed.feed.entries ?? []).map((i) =>
          finish({
            sourceId: i.id,
            link:
              alternate(i.links) ??
              (/^https?:\/\//i.test(i.id ?? "") ? i.id : undefined),
            title: i.title,
            content: i.content,
            summary: i.summary,
            pubDate: i.published ?? i.dc?.date,
            updatedAt: i.updated,
            authors: (i.authors ?? parsed.feed.authors ?? []).flatMap((a) =>
              a.name ? [a.name] : []
            ),
            image: mediaImage(i.media) ?? i.itunes?.image,
          })
        ),
      }
    case "rdf":
      return {
        format: "rdf",
        title: text(parsed.feed.title),
        items: (parsed.feed.items ?? []).map((i) =>
          finish({
            sourceId: i.rdf?.about,
            link: i.link,
            title: i.title,
            content: i.content?.encoded,
            summary: i.description,
            pubDate: i.dc?.date,
            authors: i.dc?.creator ? [i.dc.creator] : [],
            image: mediaImage(i.media),
          })
        ),
      }
    case "json":
      return {
        format: "json",
        title: text(parsed.feed.title),
        items: (parsed.feed.items ?? []).map((i) =>
          finish({
            sourceId: i.id,
            link: i.url ?? i.external_url,
            title: i.title,
            content:
              i.content_html ??
              (i.content_text
                ? `<p>${escapeText(i.content_text)}</p>`
                : undefined),
            summary: i.summary,
            pubDate: i.date_published,
            updatedAt: i.date_modified,
            authors: (i.authors ?? parsed.feed.authors ?? []).flatMap((a) =>
              a.name ? [a.name] : []
            ),
            image: i.image ?? i.banner_image,
          })
        ),
      }
  }
}
