import { inspectWebsite } from "../utils/website-preview"
import { BlockedUrlError, safeFetchText } from "../utils/fetch"
import { sectionNames, sectionsInHtml } from "../utils/discover"
import { CONTENT_SEGMENTS } from "../utils/page-feed"
import { mapWithConcurrency } from "../utils/concurrency"
import type { FeedSignals } from "../utils/feed-signals"

/**
 * Finding the page to read when a site has no feed.
 *
 * The case this exists for: someone pastes `emerline.com`, which advertises no
 * feed anywhere and whose homepage is a product page. The old answer was "No
 * feed found on that site" and a button offering to watch that homepage — which
 * would have produced a feed of their services menu. The right answer is
 * `emerline.com/blog`, and the site already tells us where that is.
 *
 * It reuses the machinery the feed search built. `sectionNames` ranks a site's
 * sections by how much of its sitemap sits under each; `sectionsInHtml` ranks
 * them by how often the navigation points at them. Those rankings were computed
 * to turn into candidate *feed* URLs and thrown away when none of them parsed.
 * Here they are the answer directly.
 */

/** One page that can be read as a feed. */
export interface PageCandidate {
  url: string
  title: string
  /** Posts found on it, which is the evidence that it is a listing. */
  itemCount: number
  sampleTitles: Array<string>
  /** The section it came from — "blog", "news" — or null when it was pasted. */
  section: string | null
  signals?: FeedSignals
  quality?: "readable" | "partial"
}

const PAGE_TIMEOUT_MS = 8_000
const PROBE_CONCURRENCY = 3
/** Sections tried. Beyond the first few the ranking stops meaning much. */
const MAX_SECTIONS_TRIED = 6
/** Pages offered. More than a few is a list to read rather than a suggestion. */
const MAX_SUGGESTIONS = 3
const TOTAL_BUDGET_MS = 14_000

async function readIfListing(
  url: string,
  section: string | null
): Promise<PageCandidate | null> {
  try {
    const result = await inspectWebsite(url)
    if (!result) return null
    return {
      url: result.url,
      title: result.title,
      itemCount: result.itemCount,
      sampleTitles: result.sampleTitles,
      section,
      signals: result.signals,
      quality: result.quality,
    }
  } catch (err) {
    if (err instanceof BlockedUrlError) throw err
    return null
  }
}

/**
 * Pages on this site that could be read as a feed, best first.
 *
 * The pasted address is tried first and separately: someone who pastes
 * `example.com/blog` has already told us where to look, and confirming it is
 * one request rather than a sitemap read.
 */
export async function discoverReadablePages(
  input: string
): Promise<Array<PageCandidate>> {
  let target: URL
  try {
    target = new URL(input)
  } catch {
    return []
  }

  const startedAt = Date.now()
  const origin = target.origin
  const found: Array<PageCandidate> = []
  const seen = new Set<string>()

  const keep = (candidate: PageCandidate | null) => {
    if (!candidate) return
    const key = candidate.url.replace(/\/+$/, "")
    if (seen.has(key)) return
    seen.add(key)
    found.push(candidate)
  }

  // The homepage and the sitemap are independent, so they go together — the
  // same reason `discoverMoreFeeds` fetches them in parallel.
  const [pasted, homepage, sitemapSections] = await Promise.all([
    readIfListing(target.href, null),
    target.href.replace(/\/+$/, "") === origin
      ? Promise.resolve(null)
      : safeFetchText(origin, { timeoutMs: PAGE_TIMEOUT_MS }).catch((err) => {
          if (err instanceof BlockedUrlError) throw err
          return null
        }),
    sectionNames(origin).catch((err) => {
      if (err instanceof BlockedUrlError) throw err
      return [] as Array<string>
    }),
  ])

  keep(pasted)
  if (found.length >= MAX_SUGGESTIONS) return found

  const navSections = homepage?.res.ok
    ? sectionsInHtml(homepage.text, origin)
    : ([] as Array<string>)

  /*
    Sitemap first, navigation second. A sitemap ranks by how much writing lives
    under a section, which is the better signal; the nav ranks by how often the
    site links to it, which favours whatever it is selling.
  */
  const sections = [...new Set([...sitemapSections, ...navSections])]
    /*
      Only sections that are writing. Emerline's sitemap ranks `/solutions` and
      `/services` above `/blog` — both are perfectly good listings of
      product pages, and offering to turn one into a feed would be offering the
      wrong thing confidently. Where a site keeps its posts somewhere unusual
      the user can paste that address, which is tried above with no such filter:
      we suggest only where we are sure, and accept whatever we are pointed at.
    */
    .filter((section) => CONTENT_SEGMENTS.has(section))
    .slice(0, MAX_SECTIONS_TRIED)

  const queue = sections
    .map((section) => ({ url: `${origin}/${section}`, section }))
    .filter((c) => !seen.has(c.url.replace(/\/+$/, "")))

  for (let i = 0; i < queue.length; i += PROBE_CONCURRENCY) {
    if (Date.now() - startedAt > TOTAL_BUDGET_MS) break
    if (found.length >= MAX_SUGGESTIONS) break

    const batch = queue.slice(i, i + PROBE_CONCURRENCY)
    const results = await mapWithConcurrency(batch, PROBE_CONCURRENCY, (c) =>
      readIfListing(c.url, c.section)
    )
    for (const result of results) {
      keep(result)
      if (found.length >= MAX_SUGGESTIONS) break
    }
  }

  // Most posts wins among the survivors: a blog has more entries than a press
  // page, and both are writing.
  return found
    .sort((a, b) => b.itemCount - a.itemCount)
    .slice(0, MAX_SUGGESTIONS)
}
