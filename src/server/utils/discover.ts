/**
 * Finds the OTHER feeds on a site, once one feed is already known.
 *
 * Two things this is not, both ruled out by measurement rather than taste:
 *
 *   • Sitemaps do not list feeds. Across eight sites checked, zero contained a
 *     single feed URL. What a sitemap is good for is SECTION NAMES.
 *   • Guessing paths blindly is a bad trade: a 48-request grid over five sites
 *     turned up exactly one feed each.
 *
 * What does work is using the site's own shape. A site that serves its main
 * feed at /rss/index.xml serves its section feeds at /rss/{section}/index.xml;
 * one that serves /feed/ serves /{section}/feed/. So: take the anchor feed we
 * already found, derive a template from its path, fill it with section names
 * from the sitemap, and probe a bounded number of those.
 */
import * as cheerio from "cheerio"
import { parseSyndication } from "./parse-feed"
import { BlockedUrlError, safeFetchText } from "./fetch"
import { mapWithConcurrency } from "./concurrency"
import { feedSignals } from "./feed-signals"
import type { FeedSignals } from "./feed-signals"

export type DiscoveredFeed = {
  url: string
  title: string | null
  itemCount: number
  sampleTitles: Array<string>
  /** 'primary' is the feed the user's URL resolved to; the rest are 'section'. */
  kind: "primary" | "section"
  /** Short label for section feeds, e.g. "tech". Null for the primary feed. */
  section: string | null
  signals: FeedSignals
}

const PROBE_TIMEOUT_MS = 6_000
const SITEMAP_TIMEOUT_MS = 5_000
const SITEMAP_MAX_BYTES = 2 * 1024 * 1024
/** Upper bound on probe requests in the deep pass. */
const MAX_PROBES = 18
const PROBE_CONCURRENCY = 6
/** Sections considered, most frequent first. */
const MAX_SECTIONS = 8
/** Wall-clock ceiling for the whole deep pass. */
const TOTAL_BUDGET_MS = 15_000
/** Never return more than this many feeds to the UI. */
export const MAX_DISCOVERED = 12

/**
 * Feed filenames tried under a section when there is no anchor to copy.
 *
 * Needed because the anchor is not a prerequisite: openai.com advertises no
 * feed on its homepage and serves nothing at /feed or /rss.xml, so the fast
 * pass finds nothing at all. Its feed lives at /news/rss.xml, and /news is
 * exactly what the sitemap reports.
 */
const SECTION_SUFFIXES = [
  "rss.xml",
  "feed",
  "feed.xml",
  "atom.xml",
  "index.xml",
  "rss",
]

/** Path segments that are never a content section. */
const SECTION_STOPWORDS = new Set([
  "sitemap",
  "sitemaps",
  "feed",
  "rss",
  "atom",
  "static",
  "assets",
  "cdn",
  "api",
  "auth",
  "login",
  "signup",
  "search",
  "tag",
  "tags",
  "author",
  "authors",
  "page",
  "pages",
  "category",
  "wp-content",
  "wp-json",
  "legal",
  "privacy",
  "terms",
  "cookie",
  "cookies",
  "contact",
  "careers",
  "jobs",
  "pricing",
  "docs",
  "doc",
  "support",
  "help",
  "account",
  "settings",
])

function isPlausibleSection(seg: string): boolean {
  if (!seg || seg.length > 24) return false
  if (SECTION_STOPWORDS.has(seg)) return false
  if (/^\d+$/.test(seg)) return false // ids, years
  if (/\.[a-z0-9]{2,5}$/i.test(seg)) return false // filenames
  return /^[a-z0-9][a-z0-9-]*$/i.test(seg)
}

/** Sitemap URLs advertised by robots.txt, plus the conventional location. */
async function sitemapUrls(origin: string): Promise<Array<string>> {
  const found: Array<string> = []
  try {
    const { res, text } = await safeFetchText(`${origin}/robots.txt`, {
      timeoutMs: PROBE_TIMEOUT_MS,
      maxBytes: 256 * 1024,
    })
    if (res.ok) {
      for (const m of text.matchAll(/^\s*sitemap:\s*(\S+)/gim)) found.push(m[1])
    }
  } catch (err) {
    if (err instanceof BlockedUrlError) throw err
  }
  if (found.length === 0) found.push(`${origin}/sitemap.xml`)
  return found.slice(0, 2)
}

function locsFrom(xml: string): Array<string> {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1])
}

/**
 * Section names for a site, ranked by how many sitemap URLs sit under them.
 * Follows one level of sitemap index, since large sites split their sitemap.
 */
export async function sectionNames(origin: string): Promise<Array<string>> {
  const counts = new Map<string, number>()

  const absorb = (locs: Array<string>) => {
    for (const loc of locs) {
      let seg: string | undefined
      try {
        const u = new URL(loc)
        if (u.origin !== origin) continue
        seg = u.pathname.split("/").filter(Boolean)[0]
      } catch {
        continue
      }
      if (!seg) continue
      const s = seg.toLowerCase()
      if (!isPlausibleSection(s)) continue
      counts.set(s, (counts.get(s) ?? 0) + 1)
    }
  }

  const read = async (url: string): Promise<string> => {
    try {
      const { res, text } = await safeFetchText(url, {
        timeoutMs: SITEMAP_TIMEOUT_MS,
        maxBytes: SITEMAP_MAX_BYTES,
      })
      return res.ok ? text : ""
    } catch (err) {
      if (err instanceof BlockedUrlError) throw err
      return ""
    }
  }

  for (const url of await sitemapUrls(origin)) {
    const xml = await read(url)
    if (!xml) continue
    const locs = locsFrom(xml)

    if (/<sitemapindex/i.test(xml)) {
      // Index of sitemaps: sample one child rather than all of them. Large
      // sites list dozens, and each is another multi-second fetch.
      const [child] = locs
      if (child) {
        const childXml = await read(child)
        if (childXml) absorb(locsFrom(childXml))
      }
      // Child sitemap filenames are often themselves section-shaped.
      absorb(locs)
    } else {
      absorb(locs)
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name)
    .slice(0, MAX_SECTIONS)
}

/**
 * Candidate URLs for a section, derived from the anchor feed's own path.
 *
 * Three shapes cover what real sites do, verified against live feeds:
 *   A  prefix the section, keep the anchor path   /feed/          -> /science/feed/
 *   B  insert before the final filename           /rss/index.xml  -> /rss/tech/index.xml
 *   C  swap the anchor's first segment            /news/rss.xml   -> /research/rss.xml
 *
 * Exported for tests.
 */
export function sectionCandidates(
  anchorUrl: string,
  section: string
): Array<string> {
  let anchor: URL
  try {
    anchor = new URL(anchorUrl)
  } catch {
    return []
  }

  const segments = anchor.pathname.split("/").filter(Boolean)
  const trailingSlash = anchor.pathname.endsWith("/")
  const out: Array<string> = []
  const push = (segs: Array<string>, slash: boolean) => {
    const path = `/${segs.join("/")}${slash && segs.length ? "/" : ""}`
    out.push(new URL(path, anchor.origin).href)
  }

  // A: /{section}/<anchor path>
  push([section, ...segments], trailingSlash)

  // B: insert the section before the last segment, when the anchor ends in a
  //    filename (index.xml, rss.xml) rather than a bare directory.
  if (segments.length >= 1 && /\./.test(segments[segments.length - 1])) {
    const head = segments.slice(0, -1)
    const file = segments[segments.length - 1]
    push([...head, section, file], false)
  }

  // C: replace the first segment, for anchors like /news/rss.xml
  if (segments.length >= 2) {
    push([section, ...segments.slice(1)], trailingSlash)
  }

  return [...new Set(out)]
}

/**
 * Section names from a page's own navigation.
 *
 * A second source for sites whose sitemap is missing or useless: Ars Technica
 * serves no usable sitemap, so its section feeds are undiscoverable from the
 * sitemap alone, but its nav links every section.
 *
 * Exported for tests.
 */
export function sectionsInHtml(html: string, origin: string): Array<string> {
  const $ = cheerio.load(html)
  const counts = new Map<string, number>()

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href")
    if (!href) return
    let u: URL
    try {
      u = new URL(href, origin)
    } catch {
      return
    }
    if (u.origin !== origin) return
    const seg = u.pathname.split("/").filter(Boolean)[0]?.toLowerCase()
    if (!seg || !isPlausibleSection(seg)) return
    counts.set(seg, (counts.get(seg) ?? 0) + 1)
  })

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name)
    .slice(0, MAX_SECTIONS)
}

/** Feed-looking links in a page's markup. Free: the HTML is already fetched. */
export function feedLinksInHtml(html: string, baseUrl: string): Array<string> {
  const $ = cheerio.load(html)
  const out = new Set<string>()
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href")
    if (!href) return
    if (
      !/(\/feed\/?$|\/rss\/?$|\.rss$|rss\.xml$|atom\.xml$|feed\.xml$|index\.xml$)/i.test(
        href
      )
    )
      return
    try {
      out.add(new URL(href, baseUrl).href)
    } catch {
      /* ignore */
    }
  })
  return [...out]
}

/**
 * Fetches and parses one candidate.
 *
 * `requireItems` is the difference between a candidate the site *advertised*
 * and one we *guessed*. A well-formed but empty XML document at a path we
 * invented is almost always a false positive — a template, a stub, a 200 that
 * should have been a 404 — so guesses have to produce something. One the site
 * links to itself is a real feed that happens to be empty, and dropping it was
 * the reason `resolveFeed` and this function disagreed about what counts.
 */
async function probeFeed(
  url: string,
  section: string | null,
  requireItems: boolean
): Promise<DiscoveredFeed | null> {
  try {
    const { res, text, finalUrl } = await safeFetchText(url, {
      timeoutMs: PROBE_TIMEOUT_MS,
    })
    if (!res.ok) return null

    const feed = parseSyndication(text, finalUrl || url)
    const items = feed.items ?? []
    if (requireItems && items.length === 0) return null

    return {
      url: finalUrl || url,
      title: feed.title?.trim() || null,
      itemCount: items.length,
      sampleTitles: items
        .slice(0, 3)
        .map((i) => i.title?.trim())
        .filter((t): t is string => !!t),
      kind: "section",
      section,
      signals: feedSignals({
        requestedUrl: url,
        finalUrl: finalUrl || url,
        feed,
      }),
    }
  } catch {
    // A dead candidate is normal; only the caller's own URL is worth reporting.
    return null
  }
}

/**
 * Identity of a feed, independent of the URL it was reached at.
 *
 * Sites commonly serve one feed from several paths (/feed, /rss, /rss.xml), so
 * deduping by URL alone shows the same feed three times. Title plus the newest
 * item's title separates genuinely different feeds without another request.
 *
 * Now a thin wrapper over `signals.identity` so the deep pass and the bulk tab
 * cannot drift apart about what "the same feed" means. Exported for tests.
 */
export function feedIdentity(feed: DiscoveredFeed): string {
  return feed.signals.identity
}

/**
 * Deep pass: look for a site's section feeds.
 *
 * Works with or without an anchor. With one, candidates copy the anchor's own
 * URL shape, which is precise. Without one, each section is tried against a
 * short list of conventional filenames, which is how a site whose homepage
 * advertises nothing still gets found.
 *
 * `known` are feed identities already shown to the user, so the same feed is
 * not offered twice under a different URL.
 */
export async function discoverMoreFeeds(opts: {
  origin: string
  anchorUrl?: string | null
  known?: Array<string>
}): Promise<Array<DiscoveredFeed>> {
  const { origin, anchorUrl = null, known = [] } = opts

  let originUrl: URL
  try {
    originUrl = new URL(origin)
  } catch {
    return []
  }

  const startedAt = Date.now()
  const seen = new Set(known)
  const found: Array<DiscoveredFeed> = []

  // The homepage and the sitemap are independent, so fetch them together. Run
  // in sequence this was the bulk of the deep pass: several seconds of waiting
  // before the first probe went out.
  const [pageResult, sitemapSections] = await Promise.all([
    safeFetchText(originUrl.origin, { timeoutMs: PROBE_TIMEOUT_MS }).catch(
      (err) => {
        if (err instanceof BlockedUrlError) throw err
        return null
      }
    ),
    sectionNames(originUrl.origin).catch((err) => {
      if (err instanceof BlockedUrlError) throw err
      return [] as Array<string>
    }),
  ])

  const explicit: Array<string> = []
  let navSections: Array<string> = []
  if (pageResult?.res.ok) {
    const base = pageResult.finalUrl || originUrl.origin
    explicit.push(...feedLinksInHtml(pageResult.text, base))
    navSections = sectionsInHtml(pageResult.text, originUrl.origin)
  }

  // Sitemap sections first (ranked by how much content sits under them), then
  // anything the nav adds.
  const sections = [...new Set([...sitemapSections, ...navSections])].slice(
    0,
    MAX_SECTIONS
  )

  // `explicit` is what the site links to itself; everything after it is our
  // guess. The distinction survives into `probeFeed`, which only demands items
  // of the guesses — see the note there.
  const derived: Array<{
    url: string
    section: string | null
    explicit: boolean
  }> = []
  for (const url of explicit)
    derived.push({ url, section: null, explicit: true })

  // Interleave by rank rather than finishing one section before starting the
  // next. Candidates outnumber the probe budget, and each section's first guess
  // is worth more than a later guess for the section above it.
  const perSection = sections.map((section) =>
    (anchorUrl
      ? sectionCandidates(anchorUrl, section)
      : SECTION_SUFFIXES.map(
          (s) => new URL(`/${section}/${s}`, originUrl.origin).href
        )
    ).map((url) => ({ url, section, explicit: false }))
  )
  const deepest = Math.max(0, ...perSection.map((c) => c.length))
  for (let rank = 0; rank < deepest; rank++) {
    for (const candidates of perSection) {
      if (candidates[rank]) derived.push(candidates[rank])
    }
  }

  // Drop the anchor itself and any duplicate URL, then bound the work.
  const seenUrls = new Set<string>()
  if (anchorUrl) seenUrls.add(anchorUrl.replace(/\/$/, ""))
  const queue = derived
    .filter(({ url }) => {
      const key = url.replace(/\/$/, "")
      if (seenUrls.has(key)) return false
      seenUrls.add(key)
      return true
    })
    .slice(0, MAX_PROBES)

  for (let i = 0; i < queue.length; i += PROBE_CONCURRENCY) {
    if (Date.now() - startedAt > TOTAL_BUDGET_MS) break
    if (found.length >= MAX_DISCOVERED) break

    const batch = queue.slice(i, i + PROBE_CONCURRENCY)
    const results = await mapWithConcurrency(batch, PROBE_CONCURRENCY, (c) =>
      probeFeed(c.url, c.section, !c.explicit)
    )

    for (const feed of results) {
      if (!feed) continue
      const id = feedIdentity(feed)
      if (seen.has(id)) continue
      seen.add(id)
      found.push(feed)
      if (found.length >= MAX_DISCOVERED) break
    }
  }

  return found
}
