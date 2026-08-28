import sanitizeHtml from "sanitize-html"
import { parseHTML } from "linkedom"
import { Readability } from "@mozilla/readability"

function resolveUrl(url: string, base?: string): string {
  if (!base) return url
  try {
    return new URL(url, base).href
  } catch {
    return url
  }
}

/**
 * Sanitize article HTML for safe client rendering. Strips scripts/styles/iframes
 * and on* handlers (sanitize-html drops anything not explicitly allowed), keeps a
 * reader-friendly tag set, resolves relative a[href]/img[src] against `baseUrl`,
 * and forces external links to open in a new tab.
 */
export function sanitizeArticleHtml(html: string, baseUrl?: string): string {
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      "img",
      "figure",
      "figcaption",
      "picture",
      "source",
      "h1",
      "h2",
    ]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      a: ["href", "name", "target", "rel"],
      img: ["src", "srcset", "sizes", "alt", "title", "width", "height", "loading"],
      source: ["src", "srcset", "type", "media", "sizes"],
      "*": ["id"],
    },
    // Drop tags we never want in a reader view, and their contents.
    exclusiveFilter: (frame) =>
      frame.tag === "script" || frame.tag === "style" || frame.tag === "iframe",
    transformTags: {
      a: (tagName, attribs) => {
        const href = attribs.href ? resolveUrl(attribs.href, baseUrl) : undefined
        return {
          tagName,
          attribs: {
            ...attribs,
            ...(href ? { href } : {}),
            target: "_blank",
            rel: "noopener noreferrer",
          },
        }
      },
      img: (tagName, attribs) => {
        const src = attribs.src ? resolveUrl(attribs.src, baseUrl) : undefined
        return {
          tagName,
          attribs: {
            ...attribs,
            ...(src ? { src } : {}),
            loading: "lazy",
          },
        }
      },
    },
  })
}

export interface ReadableResult {
  title: string | null
  contentHtml: string
  /**
   * The rest is what a *card* needs, as opposed to a reader pane: an author, a
   * sentence, a picture and a length. Readability already computes the first
   * three while it works out the article body, and the page is already parsed,
   * so collecting them here costs nothing — whereas parsing the document a
   * second time somewhere else to find an og:image would cost everything twice.
   */
  byline: string | null
  excerpt: string | null
  image: string | null
  /**
   * When the page says it was published, ISO, or null.
   *
   * A feed hands us a date; a web page has to be asked. Without this every
   * article from a watched page sorts by when *we* first saw it, so a blog's
   * whole back catalogue arrives dated today and in arbitrary order.
   */
  publishedAt: string | null
  /** Characters of article text, which is what Readability counts. */
  length: number
}

/** The minimal DOM surface these readers need, so tests can pass a stub. */
interface QueryableDocument {
  querySelector: (selector: string) => { getAttribute: (name: string) => string | null; textContent?: string | null } | null
  querySelectorAll: (selector: string) => Iterable<{ textContent?: string | null }>
}

/** A date is only believable inside this window. Outside it, it is a parse artefact. */
const EARLIEST_PLAUSIBLE = Date.parse("1995-01-01T00:00:00Z")
/** Tomorrow, roughly. Scheduled posts exist; posts from 2087 do not. */
const FUTURE_SLACK_MS = 2 * 86_400_000

function plausibleDate(raw: string | null | undefined, now = Date.now()): string | null {
  if (!raw) return null
  const at = Date.parse(raw.trim())
  if (!Number.isFinite(at)) return null
  if (at < EARLIEST_PLAUSIBLE) return null
  if (at > now + FUTURE_SLACK_MS) return null
  return new Date(at).toISOString()
}

/**
 * Every place a page might state its publication date, best evidence first.
 *
 * Ordered by how deliberate each signal is. `article:published_time` and JSON-LD
 * `datePublished` are things the site *asserts* about the article; a bare
 * `<time datetime>` is often the first of several on the page and might belong
 * to a sidebar item. `dateModified` is deliberately not consulted — a post
 * edited last week is not a post published last week, and sorting by it puts
 * old articles at the top of the feed.
 */
export function extractPublishedAt(document: QueryableDocument, now = Date.now()): string | null {
  const meta = [
    'meta[property="article:published_time"]',
    'meta[name="article:published_time"]',
    'meta[property="og:published_time"]',
    'meta[name="publish-date"]',
    'meta[name="publication_date"]',
    'meta[name="date"]',
    'meta[itemprop="datePublished"]',
  ]
  for (const selector of meta) {
    const found = plausibleDate(document.querySelector(selector)?.getAttribute("content"), now)
    if (found) return found
  }

  // JSON-LD. Sites bury the article node at different depths — inside @graph,
  // inside an array, inside an ItemList — so the whole blob is walked rather
  // than any one shape being assumed.
  for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
    const found = firstDatePublished(node.textContent ?? "", now)
    if (found) return found
  }

  const time = document.querySelector("time[datetime]")
  return plausibleDate(time?.getAttribute("datetime"), now)
}

/** Depth-first search for a `datePublished` anywhere in a JSON-LD blob. */
function firstDatePublished(json: string, now: number): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }

  // A cursor rather than a stack, so the first date the document states wins
  // rather than the last. Bounded so a pathological blob cannot spin here.
  const queue: Array<unknown> = [parsed]
  for (let i = 0; i < queue.length && i < 2_000; i++) {
    const node = queue[i]
    if (Array.isArray(node)) {
      queue.push(...node)
      continue
    }
    if (!node || typeof node !== "object") continue

    const record = node as Record<string, unknown>
    const value = record.datePublished ?? record.dateCreated
    if (typeof value === "string") {
      const found = plausibleDate(value, now)
      if (found) return found
    }
    queue.push(...Object.values(record))
  }
  return null
}

/** The first social image a page advertises, absolute. */
function readSocialImage(
  document: { querySelector: (selector: string) => { getAttribute: (name: string) => string | null } | null },
  baseUrl: string
): string | null {
  const selectors = [
    'meta[property="og:image"]',
    'meta[name="og:image"]',
    'meta[name="twitter:image"]',
    'meta[property="twitter:image"]',
  ]
  for (const selector of selectors) {
    const content = document.querySelector(selector)?.getAttribute("content")
    if (content?.trim()) return resolveUrl(content.trim(), baseUrl)
  }
  return null
}

/**
 * Extract the main article content from a full page's HTML using Mozilla
 * Readability (the engine behind Firefox/Safari Reader View), then sanitize.
 * Returns null when extraction fails or yields no usable content.
 */
export function extractReadable(html: string, baseUrl: string): ReadableResult | null {
  try {
    const { document } = parseHTML(html)
    // Read before Readability parses: `parse()` mutates the document it is
    // given, and the <head> it strips is where the social image and the
    // published date both live.
    const image = readSocialImage(document, baseUrl)
    const publishedAt = extractPublishedAt(document)

    const reader = new Readability(document)
    const article = reader.parse()
    if (!article?.content) return null
    const contentHtml = sanitizeArticleHtml(article.content, baseUrl)
    if (!contentHtml.trim()) return null

    return {
      title: article.title ?? null,
      contentHtml,
      byline: article.byline?.trim() || null,
      excerpt: article.excerpt?.trim() || null,
      image,
      publishedAt,
      length: article.length ?? 0,
    }
  } catch {
    return null
  }
}

/**
 * Decide whether a page can be embedded in an <iframe> on our origin, based on
 * its response headers. Conservative: any restrictive X-Frame-Options or a
 * frame-ancestors policy that isn't wildcard-open is treated as non-embeddable.
 */
export function checkCanEmbed(headers: Headers): boolean {
  const xfo = headers.get("x-frame-options")?.toLowerCase()
  if (xfo && (xfo.includes("deny") || xfo.includes("sameorigin"))) return false

  const csp = headers.get("content-security-policy")?.toLowerCase()
  if (csp) {
    const match = csp.match(/frame-ancestors([^;]*)/)
    if (match) {
      const value = match[1].trim()
      if (value.includes("'none'")) return false
      // Only a wildcard host source lets an arbitrary origin (us) frame it.
      if (!value.includes("*")) return false
    }
  }
  return true
}
