import sanitizeHtml from "sanitize-html"
import { parseHTML } from "linkedom"
import { Readability } from "@mozilla/readability"
import { structuredArticle } from "./structured-article"

const EXTRACTION_PREFIX = '<div data-reader-version="3">'
export function hasCurrentReaderExtraction(html: string) {
  return html.startsWith(EXTRACTION_PREFIX)
}

export function articleText(html: string) {
  return parseHTML(`<div>${html}</div>`)
    .document.documentElement.textContent.replace(/\s+/g, " ")
    .trim()
}

/** Feed refreshes may regress to teasers; keep a more complete saved body. */
export function acceptFeedReaderContent(incoming: string | null, saved?: string | null) {
  if (!incoming?.trim()) return null
  if (saved && (readerContentEndsAtHeading(incoming) || articleText(incoming).length < articleText(saved).length)) return null
  return incoming
}

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
  const embeddedFallback = () => ({
    tagName: "a",
    attribs: {
      ...(baseUrl ? { href: baseUrl } : {}),
      target: "_blank",
      rel: "noopener noreferrer",
    },
    text: "View embedded media on the original page",
  })
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      "img",
      "figure",
      "figcaption",
      "picture",
      "source",
      "h1",
      "h2",
      "video",
      "audio",
      "track",
    ]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      a: ["href", "name", "target", "rel"],
      img: [
        "src",
        "srcset",
        "sizes",
        "alt",
        "title",
        "width",
        "height",
        "loading",
        "referrerpolicy",
        "data-reader-image-theme",
      ],
      source: ["src", "srcset", "type", "media", "sizes"],
      video: [
        "src",
        "poster",
        "controls",
        "preload",
        "playsinline",
        "width",
        "height",
      ],
      audio: ["src", "controls", "preload"],
      track: ["src", "kind", "srclang", "label", "default"],
      "*": ["id"],
    },
    // Drop tags we never want in a reader view, and their contents.
    exclusiveFilter: (frame) => frame.tag === "script" || frame.tag === "style",
    transformTags: {
      iframe: embeddedFallback,
      object: embeddedFallback,
      embed: embeddedFallback,
      a: (tagName, attribs) => {
        const href = attribs.href
          ? resolveUrl(attribs.href, baseUrl)
          : undefined
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
        const lazySrc =
          attribs["data-src"] ||
          attribs["data-original"] ||
          attribs["data-lazy-src"]
        const rawSrc =
          lazySrc && (!attribs.src || /^(data:|about:blank)/i.test(attribs.src))
            ? lazySrc
            : attribs.src
        const src = rawSrc ? resolveUrl(rawSrc, baseUrl) : undefined
        const srcset = attribs["data-srcset"] || attribs.srcset
        return {
          tagName,
          attribs: {
            ...attribs,
            ...(src ? { src } : {}),
            loading: "lazy",
            ...(srcset ? { srcset: resolveSrcset(srcset, baseUrl) } : {}),
            referrerpolicy: "no-referrer",
          },
        }
      },
      source: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          ...(attribs.src ? { src: resolveUrl(attribs.src, baseUrl) } : {}),
          ...(attribs.srcset || attribs["data-srcset"]
            ? {
                srcset: resolveSrcset(
                  attribs["data-srcset"] || attribs.srcset,
                  baseUrl
                ),
              }
            : {}),
        },
      }),
      video: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          controls: "",
          preload: "none",
          playsinline: "",
          ...(attribs.src ? { src: resolveUrl(attribs.src, baseUrl) } : {}),
          ...(attribs.poster
            ? { poster: resolveUrl(attribs.poster, baseUrl) }
            : {}),
        },
      }),
      audio: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          controls: "",
          preload: "none",
          ...(attribs.src ? { src: resolveUrl(attribs.src, baseUrl) } : {}),
        },
      }),
      track: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          ...(attribs.src ? { src: resolveUrl(attribs.src, baseUrl) } : {}),
        },
      }),
    },
  })
}

/** A heading with no following body is evidence that extraction may have stopped early. */
export function readerContentEndsAtHeading(html: string): boolean {
  const { document } = parseHTML(html)
  const blocks = Array.from(
    document.querySelectorAll(
      "h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,table,img,video,audio,iframe,a"
    )
  ).filter(
    (element) =>
      !(element.tagName === "A" && element.closest("h1,h2,h3,h4,h5,h6")) &&
      (element.textContent?.trim() ||
        /^(IMG|VIDEO|AUDIO|IFRAME)$/.test(element.tagName))
  )
  return /^H[1-6]$/.test(blocks.at(-1)?.tagName ?? "")
}

function prepareReaderMedia(
  document: ReturnType<typeof parseHTML>["document"]
) {
  // Readability's lazy-image heuristic misses extensionless URLs and SVGs.
  for (const image of document.querySelectorAll("img")) {
    const lazy =
      image.getAttribute("data-src") ||
      image.getAttribute("data-original") ||
      image.getAttribute("data-lazy-src")
    const src = image.getAttribute("src")
    if (lazy && (!src || /^(data:|about:blank)/i.test(src)))
      image.setAttribute("src", lazy)
    const srcset = image.getAttribute("data-srcset")
    if (srcset) image.setAttribute("srcset", srcset)
  }
  // Preserve alternate versions of the same illustration without showing it twice.
  for (const dark of document.querySelectorAll("img.dark-mode-alternative")) {
    const light = Array.from(
      dark.parentElement?.querySelectorAll("img.light-mode") ?? []
    ).find((image) => image.getAttribute("alt") === dark.getAttribute("alt"))
    if (light) {
      light.setAttribute("data-reader-image-theme", "light")
      dark.setAttribute("data-reader-image-theme", "dark")
    }
  }
}

function recoverSplitArticle(
  html: string,
  originalContent: string
): string | null {
  const { document } = parseHTML(html)
  const originalText =
    parseHTML(originalContent)
      .document.documentElement?.textContent?.replace(/\s+/g, " ")
      .trim() ?? ""
  const signature = Array.from(
    parseHTML(originalContent).document.querySelectorAll("p")
  )
    .map((element) => element.textContent.replace(/\s+/g, " ").trim())
    .find((text) => text.length >= 100)
    ?.slice(0, 160)
  const root = Array.from(
    document.querySelectorAll('[itemprop="articleBody"],article,main')
  ).find(
    (element) =>
      signature && element.textContent.replace(/\s+/g, " ").includes(signature)
  )
  if (!root || !signature || originalText.length < 160) return null
  prepareReaderMedia(document)
  // Keep semantic content and let Readability still filter menus/related links.
  // Work inside the article, never flatten navigation or a multi-article index.
  if (root.tagName === "MAIN" && root.querySelectorAll("article").length > 1)
    return null
  document.body.replaceChildren(root)
  for (const wrapper of Array.from(root.querySelectorAll("div,section"))) {
    if (wrapper.closest("figure,table,pre,code,nav,aside,footer,form")) continue
    if (
      /(comment|related|sidebar|sponsor|social|share|newsletter|promo)/i.test(
        wrapper.className
      )
    )
      continue
    if (wrapper.id) {
      const anchor = document.createElement("a")
      anchor.id = wrapper.id
      wrapper.prepend(anchor)
    }
    wrapper.replaceWith(...wrapper.childNodes)
  }
  const recovered = new Readability(document).parse()
  if (!recovered?.content || readerContentEndsAtHeading(recovered.content))
    return null
  const recoveredText = recovered.textContent?.replace(/\s+/g, " ").trim() ?? ""
  const lastParagraph = Array.from(
    parseHTML(originalContent).document.querySelectorAll("p")
  )
    .map((element) => element.textContent.replace(/\s+/g, " ").trim())
    .filter((text) => text.length >= 100)
    .at(-1)
    ?.slice(0, 160)
  const requiredGain = readerContentEndsAtHeading(originalContent) ? 1 : 1.15
  return recoveredText.includes(signature) &&
    (!lastParagraph || recoveredText.includes(lastParagraph)) &&
    recoveredText.length > originalText.length * requiredGain
    ? recovered.content
    : null
}

function resolveSrcset(value: string | undefined, base?: string): string {
  return (value ?? "")
    .split(",")
    .flatMap((candidate) => {
      const [url, descriptor, ...extra] = candidate.trim().split(/\s+/)
      if (
        !url ||
        extra.length ||
        (descriptor && !/^\d+(?:\.\d+)?[wx]$/.test(descriptor))
      )
        return []
      const absolute = resolveUrl(url, base)
      if (!/^https?:\/\//i.test(absolute)) return []
      return [`${absolute}${descriptor ? ` ${descriptor}` : ""}`]
    })
    .join(", ")
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
  querySelector: (selector: string) => {
    getAttribute: (name: string) => string | null
    textContent?: string | null
  } | null
  querySelectorAll: (
    selector: string
  ) => Iterable<{ textContent?: string | null }>
}

/** A date is only believable inside this window. Outside it, it is a parse artefact. */
const EARLIEST_PLAUSIBLE = Date.parse("1995-01-01T00:00:00Z")
/** Tomorrow, roughly. Scheduled posts exist; posts from 2087 do not. */
const FUTURE_SLACK_MS = 2 * 86_400_000

function plausibleDate(
  raw: string | null | undefined,
  now = Date.now()
): string | null {
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
export function extractPublishedAt(
  document: QueryableDocument,
  now = Date.now()
): string | null {
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
    const found = plausibleDate(
      document.querySelector(selector)?.getAttribute("content"),
      now
    )
    if (found) return found
  }

  // JSON-LD. Sites bury the article node at different depths — inside @graph,
  // inside an array, inside an ItemList — so the whole blob is walked rather
  // than any one shape being assumed.
  for (const node of document.querySelectorAll(
    'script[type="application/ld+json"]'
  )) {
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
  document: {
    querySelector: (
      selector: string
    ) => { getAttribute: (name: string) => string | null } | null
  },
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
    if (content?.trim()) {
      try {
        const url = new URL(content.trim(), baseUrl)
        if (/^https?:$/.test(url.protocol) && !url.username && !url.password)
          return url.href
      } catch {
        /* Try the next metadata field. */
      }
    }
  }
  return null
}

export function extractSocialImage(
  html: string,
  baseUrl: string
): string | null {
  return readSocialImage(parseHTML(html).document, baseUrl)
}

/**
 * Extract the main article content from a full page's HTML using Mozilla
 * Readability (the engine behind Firefox/Safari Reader View), then sanitize.
 * Returns null when extraction fails or yields no usable content.
 */
export function extractReadable(
  html: string,
  baseUrl: string
): ReadableResult | null {
  try {
    const { document } = parseHTML(html)
    const pageTitle = document.querySelector("title")?.textContent ?? ""
    if (
      /^(checking your browser|just a moment|access denied|attention required)/i.test(
        pageTitle.trim()
      )
    )
      return null
    // Read before Readability parses: `parse()` mutates the document it is
    // given, and the <head> it strips is where the social image and the
    // published date both live.
    const image = readSocialImage(document, baseUrl)
    const publishedAt = extractPublishedAt(document)
    const structured = structuredArticle(document, baseUrl)
    const modular =
      document.querySelectorAll("main section,article section").length > 1 ||
      !!document.querySelector('[itemprop="articleBody"]')

    prepareReaderMedia(document)
    const reader = new Readability(document)
    let article
    try {
      article = reader.parse()
    } catch {
      article = null
    }
    const recovered =
      article?.content &&
      (modular || readerContentEndsAtHeading(article.content))
        ? recoverSplitArticle(html, article.content)
        : null
    let contentHtml = sanitizeArticleHtml(
      recovered ?? article?.content ?? "",
      baseUrl
    )
    const structuredHtml = structured
      ? sanitizeArticleHtml(structured.content, baseUrl)
      : ""
    const useStructured =
      !!structuredHtml &&
      articleText(structuredHtml).length >
        articleText(contentHtml).length * 1.15
    if (useStructured) contentHtml = structuredHtml
    if (!contentHtml.trim()) return null

    return {
      title: (useStructured && structured?.title) || article?.title || structured?.title || null,
      contentHtml: `${EXTRACTION_PREFIX}${contentHtml}</div>`,
      byline: article?.byline?.trim() || structured?.byline || null,
      excerpt: article?.excerpt?.trim() || structured?.excerpt || null,
      image: image || structured?.image || null,
      publishedAt,
      length: articleText(contentHtml).length,
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
