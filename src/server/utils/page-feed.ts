import { parseHTML } from "linkedom"
import { safeParseDate } from "./dates"

/**
 * Reading a blog index page as if it were a feed.
 *
 * The previous version matched `article, .post, [class*="article"]` and took the
 * first `<a>` inside each hit. That fails on most real sites and fails
 * *silently*: a page whose cards are `<div class="card">` yields nothing, and a
 * card whose first link is a category chip yields the category page as the
 * article. Emerline's blog — the case that prompted this — has neither
 * `article` nor `post` anywhere in its markup.
 *
 * This works from the two things a listing page cannot hide:
 *
 *   1. **What the site says about itself.** A surprising number of blog indexes
 *      ship JSON-LD describing their own posts. When that is present it is
 *      exact, and no heuristic can beat it.
 *
 *   2. **URL shape.** Posts on a listing page share a path template —
 *      `/blog/<slug>`, `/2026/05/<slug>`, `/insights/<slug>` — and navigation
 *      does not. Grouping every link by that template and taking the biggest
 *      article-shaped group finds the post list without knowing anything about
 *      the site's CSS. Markup changes; the URL scheme is the thing sites keep
 *      stable, because it is what their own links and search rankings depend on.
 *
 * Pure: no fetch, no database, no clock. Everything here is testable from a
 * string of HTML.
 */

/** One post found on a listing page. */
export interface PageLink {
  url: string
  title: string
  /** From a `<time datetime>` in the same card, when the page has one. */
  publishedAt: string | null
  /** How the title was found. Useful when a site produces poor results. */
  from: "jsonld" | "link-text" | "heading" | "slug"
}

/** Below this many posts a page is a page, not a listing. */
export const MIN_PAGE_LINKS = 3

/** Never more than this from one page, however long the list. */
const MAX_PAGE_LINKS = 40

/** Shorter than this and a link's text is a chevron, a date, or "Read more". */
const MIN_TITLE_CHARS = 12

/** How far up from an anchor to look for a heading or a date. */
const CARD_DEPTH = 4

/**
 * Path segments that mark a listing of listings rather than a post.
 *
 * A tag page and a blog post can share a shape (`/tag/react` looks exactly like
 * `/blog/react-hooks`), so shape alone cannot separate them — the segment
 * before the slug has to be read.
 */
const NAV_SEGMENTS = new Set([
  "tag",
  "tags",
  "category",
  "categories",
  "topic",
  "topics",
  "author",
  "authors",
  "page",
  "search",
  "archive",
  "archives",
  "feed",
  "rss",
  "login",
  "signup",
  "account",
  "cart",
  "checkout",
  "privacy",
  "terms",
  "legal",
  "cookie",
  "cookies",
  "product-launches",
  "from-the-team",
  "from-the-community",
])

/**
 * Path segments a site uses for its writing.
 *
 * Only consulted at the root of a site, where there is no page path to anchor
 * to and the biggest tidy group of links is usually a product menu:
 * emerline.com's homepage offers eight `/services/<slug>` links and three blog
 * posts, so on count alone its services become the feed. Requiring a content
 * section here means a bare homepage converts only when it genuinely lists
 * writing — and the Add flow's job is to suggest `/blog` rather than to make
 * the homepage work.
 */
export const CONTENT_SEGMENTS = new Set([
  "blog",
  "blogs",
  "news",
  "newsroom",
  "article",
  "articles",
  "post",
  "posts",
  "insights",
  "stories",
  "updates",
  "journal",
  "writing",
  "essays",
  "notes",
  "press",
  "resources",
  "research",
  "engineering",
  "changelog",
  "release-notes",
])

/** Anchor text that is a control, never a headline. */
const CONTROL_TEXT =
  /^(read more|continue reading|learn more|more|next|previous|prev|older|newer|home|share|tweet|\d+|»|«|→|←|\.{3}|…)$/i

function textOf(node: { textContent?: string | null } | null): string {
  return (node?.textContent ?? "").replace(/\s+/g, " ").trim()
}

/**
 * A URL reduced to its template.
 *
 * `/blog/top-10-payment-gateways` and `/blog/monolith-to-microservices` both
 * become `/blog/*`; `/2026/05/hello` becomes `/#/#/*`. Grouping on this is what
 * separates a run of posts from the handful of one-off navigation links around
 * them.
 */
export function urlShape(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean)
  if (parts.length === 0) return "/"
  return `/${parts
    .map((part, i) =>
      i === parts.length - 1
        ? "*"
        : /^\d+$/.test(part)
          ? "#"
          : part.toLowerCase()
    )
    .join("/")}`
}

/** Whether a final path segment reads like a post slug rather than a section. */
function slugLike(segment: string): boolean {
  if (!segment) return false
  // Pagination and ids: `/blog/2`, `/news/12345`.
  if (/^\d+$/.test(segment)) return false
  const bare = segment.replace(/\.(html?|php|aspx?)$/i, "")
  // Either several words joined by hyphens, or one long word. `/about` is
  // neither; `top-10-payment-gateways` and `announcingsomethingbig` are.
  return /-/.test(bare) ? bare.length >= 8 : bare.length >= 12
}

/** Turns `top-10-payment-gateways` into `Top 10 payment gateways`. */
function titleFromSlug(segment: string): string {
  const words = segment
    .replace(/\.(html?|php|aspx?)$/i, "")
    .replace(/[-_]+/g, " ")
    .trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

interface Anchor {
  url: string
  shape: string
  /** Last path segment, for slug-shape checks and title fallback. */
  slug: string
  text: string
  element: Element
}

/**
 * Reads the posts a page declares in JSON-LD.
 *
 * Tried first because it is not a heuristic: `ItemList`, `Blog.blogPost` and a
 * bare array of `BlogPosting` are the site stating which items are on this page
 * and what they are called.
 */
function fromJsonLd(document: Document, base: URL): Array<PageLink> {
  const found: Array<PageLink> = []
  const seen = new Set<string>()

  const typesOf = (value: unknown): Array<string> =>
    (Array.isArray(value) ? value : [value]).filter(
      (v): v is string => typeof v === "string"
    )
  const isArticle = (types: Array<string>) =>
    types.some((t) =>
      /^(BlogPosting|NewsArticle|Article|TechArticle|ScholarlyArticle|Report)$/i.test(
        t
      )
    )
  const consider = (node: Record<string, unknown>, inItemList: boolean) => {
    /*
      An explicit article type, and nothing looser. The first version also
      accepted "anything with a url and a name", which on stripe.com/blog meant
      every author's `Person` node became an article — the feed listed
      "Christian DiCarlo" beside the posts he wrote.
    */
    const types = typesOf(node["@type"])
    const nested =
      node.item && typeof node.item === "object"
        ? (node.item as Record<string, unknown>)
        : undefined
    const listEntry =
      types.includes("ListItem") &&
      (isArticle(typesOf(nested?.["@type"])) ||
        (inItemList &&
          Number.isInteger(node.position) &&
          Number(node.position) > 0))
    if (!isArticle(types) && !listEntry) return
    const rawUrl = (node.url ??
      nested?.url ??
      nested?.["@id"] ??
      node["@id"]) as string | undefined
    const rawTitle = (node.headline ??
      node.name ??
      nested?.headline ??
      nested?.name) as string | undefined
    if (typeof rawUrl !== "string" || typeof rawTitle !== "string") return

    let absolute: string
    try {
      absolute = new URL(rawUrl, base).href
    } catch {
      return
    }
    const resolved = new URL(absolute)
    if (
      !/^https?:$/.test(resolved.protocol) ||
      resolved.origin !== base.origin ||
      resolved.username ||
      resolved.password
    )
      return
    if (
      resolved.pathname
        .split("/")
        .some((p) => NAV_SEGMENTS.has(p.toLowerCase()))
    )
      return
    if (seen.has(absolute) || absolute === base.href) return
    const title = rawTitle.replace(/\s+/g, " ").trim()
    if (title.length < 3) return

    seen.add(absolute)
    const published = node.datePublished ?? nested?.datePublished
    found.push({
      url: absolute,
      title,
      publishedAt: typeof published === "string" ? published : null,
      from: "jsonld",
    })
  }

  for (const script of document.querySelectorAll(
    'script[type="application/ld+json"]'
  )) {
    let parsed: unknown
    try {
      parsed = JSON.parse(script.textContent ?? "")
    } catch {
      continue
    }
    /*
      A cursor rather than a stack, because the order posts come out in is the
      only date information many listings carry — they are newest-first, and
      popping reverses them so a blog would arrive oldest-first.
    */
    const queue: Array<{ value: unknown; inItemList: boolean }> = [
      { value: parsed, inItemList: false },
    ]
    for (let i = 0; i < queue.length && i < 5_000; i++) {
      const { value: node, inItemList } = queue[i]
      if (Array.isArray(node)) {
        queue.push(...node.map((value) => ({ value, inItemList })))
        continue
      }
      if (!node || typeof node !== "object") continue
      const record = node as Record<string, unknown>
      consider(record, inItemList)
      const list = typesOf(record["@type"]).includes("ItemList")
      queue.push(
        ...Object.entries(record).map(([key, value]) => ({
          value,
          inItemList: list && key === "itemListElement",
        }))
      )
    }
  }

  return found
}

/** Landmarks whose links are the site, not the page. */
const CHROME_TAGS = new Set(["NAV", "HEADER", "FOOTER"])
const CHROME_ROLES = new Set(["navigation", "banner", "contentinfo"])

/**
 * Whether a link belongs to the site's furniture rather than its content.
 *
 * This is what stops a mega-menu winning. Emerline's header lists eight
 * services under `/services/<slug>` — more links, more consistently shaped,
 * than the blog posts they surround — so on link count alone the navigation is
 * a better "post list" than the posts.
 */
function inChrome(element: Element): boolean {
  let node: Element | null = element
  while (node) {
    if (CHROME_TAGS.has(node.tagName)) return true
    const role = node.getAttribute?.("role")
    if (role && CHROME_ROLES.has(role.toLowerCase())) return true
    node = node.parentElement
  }
  return false
}

/** Every same-origin link on the page, resolved and de-fragmented. */
function collectAnchors(document: Document, base: URL): Array<Anchor> {
  const anchors: Array<Anchor> = []

  for (const element of document.querySelectorAll("a[href]")) {
    const href = element.getAttribute("href")
    if (
      !href ||
      href.startsWith("#") ||
      /^(mailto|tel|javascript):/i.test(href)
    )
      continue
    if (inChrome(element)) continue

    let url: URL
    try {
      url = new URL(href, base)
    } catch {
      continue
    }
    if (url.origin !== base.origin) continue

    // The fragment is a position on a page, never a different post; the query
    // string usually is not either, and keeping it would make `?ref=nav`
    // versions of one post look like several.
    url.hash = ""
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|ref$)/i.test(key)) url.searchParams.delete(key)
    }
    const pathname = url.pathname.replace(/\/+$/, "") || "/"
    url.pathname = pathname
    if (url.href === base.href || pathname === "/") continue

    const parts = pathname.split("/").filter(Boolean)
    anchors.push({
      url: url.href,
      shape: urlShape(pathname),
      slug: parts[parts.length - 1] ?? "",
      text: textOf(element),
      element: element,
    })
  }

  return anchors
}

/** Beyond this a run of text is an excerpt or a whole card, not a headline. */
const MAX_TITLE_CHARS = 200

/**
 * The longest piece of text inside a link that is not glued to anything else.
 *
 * The card-without-a-heading case, which is most of them: OpenAI and Anthropic
 * both wrap the whole tile in one anchor and mark the headline up as a plain
 * `<div>`, so reading the anchor's text gives
 * "Testing ads in ChatGPTCompanyAug 11, 2026". Each of those three is its own
 * leaf element, and the headline is reliably the longest — the other two are a
 * category and a date.
 */
function longestLeafText(element: Element): string | null {
  let best: string | null = null
  for (const node of element.querySelectorAll("*")) {
    if (node.children.length > 0) continue
    const text = textOf(node)
    if (text.length < MIN_TITLE_CHARS || text.length > MAX_TITLE_CHARS) continue
    if (CONTROL_TEXT.test(text)) continue
    if (!best || text.length > best.length) best = text
  }
  return best
}

/**
 * The best title for a link, in order of how likely it is to be the headline.
 *
 * A heading *inside* the anchor wins outright, and that ordering is the whole
 * trick. Card layouts wrap the entire tile in one link, so the anchor's text is
 * the headline with the category, the author and the date glued to both ends —
 * "Fintech·Emerline Team· 4 hours agoTop 10 Payment Gateways for Businesses".
 * The `<h3>` inside it is exactly the headline and nothing else.
 */
function titleFor(
  element: Element,
  slug: string
): { title: string; from: PageLink["from"] } {
  const inner = textOf(element.querySelector("h1, h2, h3, h4"))
  if (inner.length >= 3) return { title: inner, from: "heading" }

  const leaf = longestLeafText(element)
  if (leaf) return { title: leaf, from: "heading" }

  const own = textOf(element)
  if (own.length >= MIN_TITLE_CHARS && !CONTROL_TEXT.test(own)) {
    return { title: own, from: "link-text" }
  }

  const direct =
    element.getAttribute("aria-label") ?? element.getAttribute("title")
  if (direct && direct.trim().length >= MIN_TITLE_CHARS) {
    return { title: direct.replace(/\s+/g, " ").trim(), from: "link-text" }
  }

  // Outward: just as often the heading is the anchor's sibling rather than its
  // child, with the link wrapping only the thumbnail.
  let node: Element | null = element.parentElement
  for (
    let depth = 0;
    node && depth < CARD_DEPTH;
    depth++, node = node.parentElement
  ) {
    const heading = textOf(node.querySelector("h1, h2, h3, h4"))
    if (heading.length >= 3) return { title: heading, from: "heading" }
  }

  const alt = element.querySelector("img")?.getAttribute("alt")
  if (alt && alt.trim().length >= MIN_TITLE_CHARS) {
    return { title: alt.replace(/\s+/g, " ").trim(), from: "heading" }
  }

  if (own.length >= 3 && !CONTROL_TEXT.test(own))
    return { title: own, from: "link-text" }

  // Last resort. A slug is a worse title than a headline but a far better one
  // than "Read more", and it is never empty.
  return { title: titleFromSlug(slug), from: "slug" }
}

/** A `<time datetime>` in the anchor or its card. */
function dateNear(element: Element): string | null {
  const own = element.querySelector("time[datetime]")?.getAttribute("datetime")
  if (own) return own
  const textDate = (container: Element): string | null => {
    for (const leaf of container.querySelectorAll("*")) {
      if (leaf.children.length) continue
      const value = textOf(leaf)
      if (
        !/^(?:[A-Z][a-z]{2,8} \d{1,2},? \d{4}|\d{4}-\d{2}-\d{2})$/.test(value)
      )
        continue
      const parsed = safeParseDate(value)
      if (parsed) return parsed
    }
    return null
  }
  const direct = textDate(element)
  if (direct) return direct

  let node: Element | null = element.parentElement
  for (
    let depth = 0;
    node && depth < CARD_DEPTH;
    depth++, node = node.parentElement
  ) {
    const found = node.querySelector("time[datetime]")?.getAttribute("datetime")
    if (found) return found
    // Do not borrow another card's publication date from a whole listing container.
    if (node.querySelectorAll("a[href]").length > 3) break
    const nearby = textDate(node)
    if (nearby) return nearby
  }
  return null
}

/**
 * Picks the group of links that is the post list.
 *
 * Size is the base score, but it cannot be the only one — a mega-menu is bigger
 * and tidier than a page of posts. The deciding signal is the listing page's
 * own address: you are on `/blog`, so the posts are the links under `/blog/`.
 * That is not a heuristic about markup, it is how sites are organised, and it
 * survives redesigns.
 */
function bestGroup(anchors: Array<Anchor>, base: URL): Array<Anchor> | null {
  const here = base.pathname
    .split("/")
    .filter(Boolean)
    .map((s) => s.toLowerCase())

  const groups = new Map<string, Array<Anchor>>()
  for (const anchor of anchors) {
    if (!slugLike(anchor.slug) || NAV_SEGMENTS.has(anchor.slug.toLowerCase()))
      continue

    const segments = anchor.shape.split("/").filter(Boolean)
    // `/tag/*` and `/author/*` are listings of listings, not posts.
    if (segments.slice(0, -1).some((s) => NAV_SEGMENTS.has(s))) continue

    const bucket = groups.get(anchor.shape)
    if (bucket) bucket.push(anchor)
    else groups.set(anchor.shape, [anchor])
  }

  let best: Array<Anchor> | null = null
  let bestScore = -1
  for (const [shape, bucket] of groups) {
    // Distinct URLs: one post linked from its image and its headline is one post.
    const distinct = new Set(bucket.map((a) => a.url)).size
    if (distinct < MIN_PAGE_LINKS) continue

    const segments = shape.split("/").filter(Boolean)

    // At the root there is no path to anchor to, so a content section is the
    // only evidence that these are posts. See CONTENT_SEGMENTS.
    if (here.length === 0 && !CONTENT_SEGMENTS.has(segments[0] ?? "")) continue

    /*
      Being in the page's own section is a strong preference, not a rule. It has
      to be strong enough to beat any count — a sidebar of promos can outnumber
      the posts — but it cannot be mandatory: openai.com lists its posts at
      /index/<slug> from a page at /news/, and requiring the match found nothing
      there at all.
    */
    const under = here.length > 0 && here.every((seg, i) => segments[i] === seg)

    // Depth breaks the tie between `/blog/*` and a dated `/blog/#/#/*`.
    const score = distinct + segments.length + (under ? 1_000 : 0)
    if (score > bestScore) {
      best = bucket
      bestScore = score
    }
  }
  return best
}

/**
 * The posts on a listing page, in the order the page lists them.
 *
 * Document order is kept deliberately: blog indexes are newest-first, and that
 * ordering is often the only date information a listing page carries.
 */
export function extractPageLinks(
  html: string,
  pageUrl: string
): Array<PageLink> {
  let base: URL
  try {
    base = new URL(pageUrl)
  } catch {
    return []
  }

  let document: Document
  try {
    ;({ document } = parseHTML(html) as unknown as { document: Document })
  } catch {
    return []
  }

  const declared = fromJsonLd(document, base)
  if (declared.length >= MIN_PAGE_LINKS)
    return declared.slice(0, MAX_PAGE_LINKS)

  const group = bestGroup(collectAnchors(document, base), base)
  if (!group)
    return declared.length > 0 ? declared.slice(0, MAX_PAGE_LINKS) : []

  /*
    One entry per URL, keeping the anchor with the most text. A card links the
    same post two or three times — from its image, its headline and a "Read
    more" — and only one of those carries the headline. The old scraper took
    the first, which is usually the image.
  */
  const byUrl = new Map<string, Anchor>()
  for (const anchor of group) {
    const existing = byUrl.get(anchor.url)
    if (!existing || anchor.text.length > existing.text.length)
      byUrl.set(anchor.url, anchor)
  }

  const out: Array<PageLink> = []
  for (const anchor of byUrl.values()) {
    const { title, from } = titleFor(anchor.element, anchor.slug)
    if (title.length < 3) continue
    out.push({
      url: anchor.url,
      title,
      publishedAt: dateNear(anchor.element),
      from,
    })
  }

  return out.slice(0, MAX_PAGE_LINKS)
}

/** Whether a page can usefully be read as a feed. */
export function looksLikeListing(html: string, pageUrl: string): boolean {
  return extractPageLinks(html, pageUrl).length >= MIN_PAGE_LINKS
}
