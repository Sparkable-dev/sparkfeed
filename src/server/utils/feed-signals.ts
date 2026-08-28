/**
 * What we can tell about a feed from the bytes we already fetched.
 *
 * Discovery used to report a title and an item count, which answers "is this a
 * feed" and nothing else. It could not tell you that the option it just offered
 * publishes nothing since March 2023, or that it is the WordPress *comments*
 * feed — advertised in the same `<link>` block as the real one, with a nearly
 * identical name. Both facts were sitting in the parse result and were thrown
 * away.
 *
 * Every signal here is computed from an already-parsed feed. Nothing in this
 * file fetches, touches the database, or reads the clock without being asked
 * (`now` is an argument so tests are not time-dependent). That constraint is
 * what lets every surface — the Add dialog, the AI's `verify_feed`, the REST
 * API — compute the same answers without any of them paying for a round trip.
 *
 * Deliberately not included: anything needing a second request (favicon,
 * certificate, robots.txt, WebSub) and anything the reader could not act on
 * (byte size, language, ad density).
 */

/** Below this a feed reads as current. */
export const FRESH_DAYS = 14
/** Between FRESH and here it is slow but alive. Past it, quiet. */
export const SLOW_DAYS = 60

/** Items sampled when deciding whether a feed carries whole articles. */
const FULLTEXT_SAMPLE = 10
/** Characters above which an item body is a post rather than a teaser. */
const FULLTEXT_CHARS = 800

const DAY_MS = 86_400_000
const WEEK_MS = 7 * DAY_MS

export type Freshness = "fresh" | "slow" | "quiet" | "unknown"
export type Fulltext = "full" | "summary" | "unknown"

/**
 * The things worth saying out loud about a candidate, most severe first.
 *
 * A closed union rather than free text: the client turns each one into a label,
 * and `Record<FeedSignalCode, …>` makes forgetting one a type error rather than
 * a blank space in the UI.
 */
export type FeedSignalCode =
  | "no_items"
  | "comments_feed"
  | "quiet"
  | "summary_only"
  | "insecure"
  | "redirected"

/** Severity order, used to sort `codes` and to decide what a row leads with. */
const CODE_ORDER: Array<FeedSignalCode> = [
  "no_items",
  "comments_feed",
  "quiet",
  "summary_only",
  "insecure",
  "redirected",
]

export interface FeedSignals {
  itemCount: number
  /** Newest item's date, ISO. Null when nothing on the page carries one. */
  lastPublishedAt: string | null
  daysSinceLastPost: number | null
  /** Rounded posts per week across the span the page covers. Null when unknowable. */
  postsPerWeek: number | null
  freshness: Freshness
  fullText: Fulltext
  isCommentsFeed: boolean
  insecure: boolean
  /** True when the address that parsed is not the one that was asked for. */
  redirected: boolean
  /**
   * Identity independent of URL, for deduping.
   *
   * Sites serve one feed from several paths (/feed, /rss, /rss.xml), so
   * deduping by URL alone shows the same feed three times. Title plus the
   * newest item's title separates genuinely different feeds without another
   * request.
   */
  identity: string
  codes: Array<FeedSignalCode>
}

/** The shape this module needs out of rss-parser, and no more. */
export interface ParsedFeedLike {
  title?: string | null
  items?: Array<Record<string, unknown>>
}

/**
 * A WordPress comments feed, which is not what anybody meant to subscribe to.
 *
 * This is the single biggest source of bad adds. WordPress advertises
 * `/comments/feed` in the same `<link rel="alternate">` block as the post feed,
 * so it arrives looking exactly as legitimate, and its title differs by one
 * word. Three ways to spot it, because sites disagree about which they use.
 *
 * The title rules are anchored at the start on purpose: a post *called*
 * "Comments on the new API" must not take a whole feed out of the running.
 */
export function isCommentsFeed(url: string, title: string | null): boolean {
  let parsed: URL | null = null
  try {
    parsed = new URL(url)
  } catch {
    /* fall through to the title rules */
  }

  if (parsed) {
    if (/\/comments\/feed\/?$/i.test(parsed.pathname)) return true
    if (/(^|[?&])feed=comments-/i.test(parsed.search)) return true
  }

  const name = (title ?? "").trim().toLowerCase()
  if (!name) return false
  if (/^comments (on|for)\b/.test(name)) return true
  // WordPress's own default: "Site Name » Comments Feed".
  if (/[»›]\s*comments(\s+feed)?$/.test(name)) return true
  return false
}

/**
 * Posting rate from the dates on one page of items.
 *
 * Measured across the span the page actually covers rather than the last seven
 * days, because a feed that posts monthly would otherwise report zero and read
 * as dead. A single-item or same-day feed has no span to divide by, so it
 * reports no rate rather than an infinite one.
 *
 * Moved here verbatim from `services/discovery.ts`, where only `verify_feed`
 * could reach it. The rounding rule below is deliberate and is pinned by tests.
 */
export function readCadence(dates: Array<string>): {
  postsPerWeek: number | null
  lastPublishedAt: string | null
} {
  const times = dates
    .map((d) => new Date(d).getTime())
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => b - a)

  if (times.length === 0) return { postsPerWeek: null, lastPublishedAt: null }

  const lastPublishedAt = new Date(times[0]).toISOString()
  const spanMs = times[0] - times[times.length - 1]
  if (times.length < 2 || spanMs < DAY_MS) {
    return { postsPerWeek: null, lastPublishedAt }
  }

  const perWeek = (times.length / spanMs) * WEEK_MS
  return {
    // One decimal below 1, whole numbers above: "0.4 a week" is meaningful,
    // "12.3 a week" is false precision.
    postsPerWeek: perWeek < 1 ? Math.round(perWeek * 10) / 10 : Math.round(perWeek),
    lastPublishedAt,
  }
}

/** ISO dates from the items, undated ones omitted. */
export function publishedDates(items: Array<Record<string, unknown>>): Array<string> {
  return items
    .map((i) => (i.isoDate ?? i.pubDate) as string | undefined)
    .filter((d): d is string => typeof d === "string" && d.length > 0)
}

/**
 * Whether items carry whole articles or teasers.
 *
 * All three fields are already in rss-parser's output, so this costs a
 * `.length` per item on data we parsed and discarded. It matters because it
 * decides what the reader actually gets: a summary-only feed means every
 * article is a click out to the site.
 *
 * `summary` is in the list because Atom puts the body there — Simon Willison's
 * feed carries no `content` at all, and without it every Atom feed of that
 * shape was reported as summary-only on the strength of having looked in the
 * wrong place.
 *
 * "Half the sample is long" rather than "any item is long", because a single
 * post that happens to be verbose says nothing about the feed. And a feed where
 * we found no body text at all is `unknown`, not `summary`: saying "summaries"
 * because we did not look successfully is a claim, not a measurement.
 */
function readFulltext(items: Array<Record<string, unknown>>): Fulltext {
  if (items.length === 0) return "unknown"

  const sample = items.slice(0, FULLTEXT_SAMPLE)
  let long = 0
  let seen = 0
  for (const item of sample) {
    const body =
      (item["content:encoded"] as string | undefined) ||
      (item.content as string | undefined) ||
      (item.summary as string | undefined) ||
      ""
    if (body.length === 0) continue
    seen++
    if (body.length > FULLTEXT_CHARS) long++
  }

  if (seen === 0) return "unknown"
  if (long * 2 >= seen) return "full"
  return long === 0 ? "summary" : "unknown"
}

function readFreshness(daysSince: number | null): Freshness {
  if (daysSince === null) return "unknown"
  if (daysSince <= FRESH_DAYS) return "fresh"
  if (daysSince <= SLOW_DAYS) return "slow"
  return "quiet"
}

/** Scheme and trailing slashes should not make two addresses look different. */
function sameAddress(a: string, b: string): boolean {
  const strip = (u: string) =>
    u.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "")
  return strip(a) === strip(b)
}

export function feedSignals(input: {
  /** What was asked for — the user's URL, or the candidate we chose to probe. */
  requestedUrl: string
  /** What actually parsed, after redirects. */
  finalUrl: string
  feed: ParsedFeedLike
  now?: number
}): FeedSignals {
  const now = input.now ?? Date.now()
  const items = input.feed.items ?? []
  const title = input.feed.title?.trim() || null

  const { postsPerWeek, lastPublishedAt } = readCadence(publishedDates(items))
  const daysSinceLastPost =
    lastPublishedAt === null
      ? null
      : Math.max(0, Math.floor((now - Date.parse(lastPublishedAt)) / DAY_MS))

  const freshness = readFreshness(daysSinceLastPost)
  const fullText = readFulltext(items)
  const comments = isCommentsFeed(input.finalUrl, title)
  const insecure = input.finalUrl.startsWith("http://")
  const redirected = !sameAddress(input.requestedUrl, input.finalUrl)

  const firstTitle = (items[0]?.title as string | undefined)?.trim() ?? ""

  const flags: Record<FeedSignalCode, boolean> = {
    no_items: items.length === 0,
    comments_feed: comments,
    quiet: freshness === "quiet",
    summary_only: fullText === "summary",
    insecure,
    redirected,
  }

  return {
    itemCount: items.length,
    lastPublishedAt,
    daysSinceLastPost,
    postsPerWeek,
    freshness,
    fullText,
    isCommentsFeed: comments,
    insecure,
    redirected,
    identity: `${(title ?? "").toLowerCase()}::${firstTitle.toLowerCase()}`,
    codes: CODE_ORDER.filter((code) => flags[code]),
  }
}

/**
 * Signals for a candidate we could not parse, so a row always has something.
 *
 * Used by the bulk tab, where a URL that failed still occupies a line and the
 * renderer should not have to special-case a missing object.
 */
export function emptySignals(url: string): FeedSignals {
  return {
    itemCount: 0,
    lastPublishedAt: null,
    daysSinceLastPost: null,
    postsPerWeek: null,
    freshness: "unknown",
    fullText: "unknown",
    isCommentsFeed: false,
    insecure: url.startsWith("http://"),
    redirected: false,
    identity: "",
    codes: [],
  }
}

/**
 * Whether a candidate should start ticked.
 *
 * Kept beside the signals rather than in the component, because the same rule
 * has to hold on both tabs and in any future surface that offers a list of
 * candidates. Only the unambiguous mistakes are excluded — a quiet feed is
 * flagged and still ticked, because "this blog posts twice a year" is often
 * exactly why you are subscribing.
 */
export function shouldAutoSelect(signals: FeedSignals, alreadyAdded: boolean): boolean {
  if (alreadyAdded) return false
  if (signals.isCommentsFeed) return false
  if (signals.itemCount === 0) return false
  return true
}
