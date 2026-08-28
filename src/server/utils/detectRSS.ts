/**
 * Resolves whatever a user typed into an actual, parseable feed URL.
 *
 * Order matters:
 *   1. the URL itself, in case they pasted a feed directly
 *   2. every <link rel="alternate"> the page advertises
 *   3. conventional paths, relative to both the origin and the current directory
 *
 * Candidates are validated by really parsing them with rss-parser, not by
 * looking for "<?xml" in the body. The old substring check matched any XHTML
 * page, which produced feeds that could never parse again.
 */
import * as cheerio from 'cheerio'
import Parser from 'rss-parser'
import { BlockedUrlError, looksLikeFeedContentType, safeFetchText } from './fetch'
import { feedSignals, publishedDates } from './feed-signals'
import type { FeedSignals } from './feed-signals'
import { normalizeFeedUrl } from '@/lib/validation'

export type ResolvedFeed = {
  /** The URL that actually parsed as a feed. */
  url: string
  title: string | null
  itemCount: number
  sampleTitles: Array<string>
  /**
   * Publication dates of the items, ISO, unsorted, undated items omitted.
   *
   * Taken from the parse that already happened, so it costs nothing here. It is
   * what lets `verify_feed` say "about 4 posts a week, last one yesterday" —
   * the two facts that decide whether a source is worth subscribing to, and the
   * two a name and a URL cannot tell you.
   */
  publishedDates: Array<string>
  /**
   * Everything else the parse can tell us: cadence, staleness, whether this is
   * a comments feed, whether items carry whole articles. See `feed-signals.ts`.
   */
  signals: FeedSignals
}

const CANDIDATE_TIMEOUT_MS = 6_000
const MAX_CANDIDATE_FETCHES = 8
/** Probes run in small parallel batches so a run of dead paths cannot stack up timeouts. */
const PROBE_BATCH_SIZE = 3
/** Hard ceiling on the whole resolution, so the Check button always returns promptly. */
const TOTAL_BUDGET_MS = 20_000
const COMMON_PATHS = [
  'feed',
  'rss',
  'rss.xml',
  'feed.xml',
  'atom.xml',
  'index.xml',
  'feed/',
]

const parser = new Parser()

async function tryCandidate(url: string): Promise<ResolvedFeed | null> {
  try {
    const { res, text, contentType, finalUrl } = await safeFetchText(url, {
      timeoutMs: CANDIDATE_TIMEOUT_MS,
    })
    if (!res.ok) return null
    if (!looksLikeFeedContentType(contentType)) return null

    const feed = await parser.parseString(text)
    const items = feed.items ?? []
    return {
      url: finalUrl || url,
      title: feed.title?.trim() || null,
      itemCount: items.length,
      sampleTitles: items
        .slice(0, 3)
        .map((i) => i.title?.trim())
        .filter((t): t is string => !!t),
      publishedDates: publishedDates(items),
      signals: feedSignals({
        requestedUrl: url,
        finalUrl: finalUrl || url,
        feed,
      }),
    }
  } catch (err) {
    // A blocked address is a hard stop, not a "try the next candidate" signal.
    if (err instanceof BlockedUrlError) throw err
    return null
  }
}

/** Absolute feed URLs advertised by a page's <link rel="alternate"> tags, rss before atom, document order otherwise. Exported for tests. */
export function linkTagCandidates(html: string, baseUrl: string): Array<string> {
  const $ = cheerio.load(html)
  const rss: Array<string> = []
  const atom: Array<string> = []

  $('link[type], a[type]').each((_, el) => {
    const type = ($(el).attr('type') ?? '').toLowerCase()
    const rel = ($(el).attr('rel') ?? '').toLowerCase()
    const href = $(el).attr('href')
    if (!href) return
    // rel is usually "alternate" but plenty of sites omit it entirely.
    if (rel && !rel.split(/\s+/).includes('alternate')) return

    let absolute: string
    try {
      absolute = new URL(href, baseUrl).href
    } catch {
      return
    }

    // Match the media type, not a substring of it. `image/svg+xml` contains
    // "xml", so a loose check made every site's favicon the first candidate we
    // probed, burning budget before any real feed was tried.
    if (type.includes('rss') || type.includes('rdf')) rss.push(absolute)
    else if (type.includes('atom')) atom.push(absolute)
    else if (type === 'text/xml' || type === 'application/xml') rss.push(absolute)
  })

  return [...rss, ...atom]
}

/**
 * Conventional feed paths, tried against both the origin and the directory the
 * user's URL points at. The previous implementation used `new URL('/feed', u)`,
 * which always resolves to the origin, so a feed living under a sub-path was
 * never found.
 *
 * Exported for tests.
 */
export function commonPathCandidates(base: URL): Array<string> {
  const out: Array<string> = []
  const dir = base.pathname.endsWith('/') ? base.pathname : `${base.pathname.replace(/[^/]*$/, '')}`

  for (const path of COMMON_PATHS) {
    out.push(new URL(`/${path}`, base.origin).href)
    if (dir && dir !== '/') out.push(new URL(`${dir}${path}`, base.origin).href)
  }
  return out
}

function dedupe(urls: Array<string>): Array<string> {
  const seen = new Set<string>()
  return urls.filter((u) => {
    const key = u.replace(/\/$/, '')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Best-effort resolution of a site or feed URL to a real feed.
 * Returns null when nothing parses. Throws BlockedUrlError for addresses we
 * refuse to reach.
 */
export async function resolveFeed(input: string): Promise<ResolvedFeed | null> {
  const normalized = normalizeFeedUrl(input)
  if (!normalized) return null
  const base = new URL(normalized)

  const startedAt = Date.now()
  let budget = MAX_CANDIDATE_FETCHES

  // 1. The URL itself. This is the case that used to fall through to the
  //    scraper: pasting https://example.com/rss.xml found no <link> tag,
  //    probed /feed on the origin, and gave up.
  const direct = await tryCandidate(normalized)
  budget--
  if (direct) return direct

  // 2. Whatever the page advertises. Re-fetch as HTML; the direct attempt
  //    above may have bailed on content-type before reading anything useful.
  let html = ''
  let htmlBase = normalized
  try {
    const page = await safeFetchText(normalized, { timeoutMs: CANDIDATE_TIMEOUT_MS })
    budget--
    if (page.res.ok) {
      html = page.text
      htmlBase = page.finalUrl || normalized
    }
  } catch (err) {
    if (err instanceof BlockedUrlError) throw err
  }

  // Body links matter as much as <link> tags: openai.com advertises no feed in
  // its head but links /news/rss.xml in the page, and without this the fast
  // pass returns nothing for a bare openai.com.
  const { feedLinksInHtml } = await import('./discover')

  const candidates = dedupe([
    ...(html ? linkTagCandidates(html, htmlBase) : []),
    ...(html ? feedLinksInHtml(html, htmlBase) : []),
    ...commonPathCandidates(base),
  ]).filter((c) => c !== normalized)

  // 3. Probe in priority order, a few at a time. Within a batch the
  //    highest-priority success wins, so batching does not change which feed we
  //    pick, only how long it takes to find it.
  for (let i = 0; i < candidates.length && budget > 0; i += PROBE_BATCH_SIZE) {
    if (Date.now() - startedAt > TOTAL_BUDGET_MS) break

    const batch = candidates.slice(i, i + Math.min(PROBE_BATCH_SIZE, budget))
    budget -= batch.length

    // A derived candidate that redirects somewhere blocked just loses its turn;
    // the URL the user actually typed was already checked above.
    const settled = await Promise.all(batch.map((c) => tryCandidate(c).catch(() => null)))
    const hit = settled.find((r) => r !== null)
    if (hit) return hit
  }

  return null
}

/** @deprecated Use resolveFeed, which also returns the feed's title and item count. */
export async function detectRSSFeed(url: string): Promise<string | null> {
  const resolved = await resolveFeed(url)
  return resolved?.url ?? null
}
