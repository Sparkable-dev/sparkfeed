import { inArray } from "drizzle-orm"
import { inspectWebsite } from "../utils/website-preview"
import { resolveFeed } from "../utils/detectRSS"
import { discoverMoreFeeds } from "../utils/discover"
import { readCatalogue } from "./catalogue"
import { feedInWorkspace } from "./tenancy"
import { invalidArgument, upstreamFailed } from "./errors"
import type { ApiPrincipal } from "../api/principal"
import type { FeedSignals } from "../utils/feed-signals"
import { catalogueArticles, feeds } from "@/db/schema"
import { db } from "@/db/index"
import { feedUrlKey } from "@/lib/validation"

/**
 * Finding feeds the workspace does not have yet.
 *
 * Two modes, because "find me feeds about X" and "find the feeds on this site"
 * are different questions with different machinery:
 *
 * - `topic` searches the curated catalogue. Entirely offline — no outbound
 *   request — so it is fast, predictable, and safe to call speculatively.
 * - `url` resolves a real address, then looks for sibling section feeds. This
 *   fetches, so it is gated on `principal.demo` the same way `getArticle` is:
 *   the demo key is public, and an endpoint that fetches arbitrary
 *   caller-supplied URLs is an open proxy.
 *
 * Every result is checked against the workspace's existing feeds and marked
 * `already_subscribed`, so the model recommends adding things that are actually
 * missing rather than re-suggesting what the user already reads.
 */

export interface FeedCandidate {
  source_kind?: "rss" | "page"
  verification?: "cached" | "live"
  quality?: "readable" | "partial"
  last_published_at?: string | null
  url: string
  title: string
  description: string | null
  site_url: string | null
  /** Recent headlines, so the user can judge a source without subscribing. */
  sample_titles: Array<string>
  item_count: number | null
  source: "catalogue" | "site"
  /** Only set for catalogue hits. */
  category: string | null
  /** Catalogue slug, when the candidate came from the curated list. */
  slug: string | null
  already_subscribed: boolean
}

export interface FindFeedsArgs {
  topic?: string
  url?: string
  limit?: number
}

/**
 * What `verify_feed` reports back about one address.
 *
 * `valid: false` is a normal answer, not an error. "Is this a feed?" is a
 * question with two useful answers, and throwing on the interesting one would
 * make the model apologise instead of saying "that page has no feed, but the
 * site does — here it is".
 */
export interface FeedVerification {
  source_kind?: "rss" | "page"
  quality?: "readable" | "partial"
  valid: boolean
  /** The address that actually parsed, which is often not the one given. */
  url: string | null
  requested_url: string
  title: string | null
  site_url: string | null
  item_count: number | null
  sample_titles: Array<string>
  /** Rounded posts per week over the items on the page. Null when undated. */
  posts_per_week: number | null
  last_published_at: string | null
  already_subscribed: boolean
  /**
   * Everything the parse can say beyond "it is a feed": staleness, whether it
   * is a comments feed, whether items carry whole articles. Null when nothing
   * parsed. Same object the Add dialog renders, so the two cannot disagree.
   */
  signals: FeedSignals | null
  /** Why it is not a feed, in words meant for the person reading. */
  reason: string | null
}

export async function verifyFeed(
  principal: ApiPrincipal,
  args: { url: string }
): Promise<FeedVerification> {
  if (principal.demo) {
    throw invalidArgument("Checking a URL is disabled in demo mode.")
  }

  const miss = (reason: string): FeedVerification => ({
    valid: false,
    url: null,
    requested_url: args.url,
    title: null,
    site_url: originOf(args.url),
    item_count: null,
    sample_titles: [],
    posts_per_week: null,
    last_published_at: null,
    already_subscribed: false,
    signals: null,
    reason,
  })

  let resolved
  try {
    resolved = await resolveFeed(args.url)
  } catch (err) {
    return miss(
      err instanceof Error ? err.message : "Could not reach that address."
    )
  }

  if (!resolved) {
    try {
      const page = await inspectWebsite(args.url)
      if (!page)
        return miss(`No feed or readable article listing found at ${args.url}.`)
      const subscribed = await subscribedUrls(principal)
      return {
        valid: true,
        source_kind: "page",
        quality: page.quality,
        url: page.url,
        requested_url: args.url,
        title: page.title,
        site_url: originOf(page.url),
        item_count: page.itemCount,
        sample_titles: page.sampleTitles,
        posts_per_week: null,
        last_published_at: page.signals.lastPublishedAt,
        already_subscribed: subscribed.has(feedUrlKey(page.url)),
        signals: page.signals,
        reason: null,
      }
    } catch (err) {
      return miss(
        err instanceof Error ? err.message : "Could not read the website."
      )
    }
  }

  const subscribed = await subscribedUrls(principal)

  return {
    valid: true,
    source_kind: "rss",
    url: resolved.url,
    requested_url: args.url,
    title: resolved.title,
    site_url: originOf(resolved.url),
    item_count: resolved.itemCount,
    sample_titles: resolved.sampleTitles,
    posts_per_week: resolved.signals.postsPerWeek,
    last_published_at: resolved.signals.lastPublishedAt,
    already_subscribed: subscribed.has(feedUrlKey(resolved.url)),
    signals: resolved.signals,
    reason: null,
  }
}

const DEFAULT_LIMIT = 8
const MAX_LIMIT = 20

export async function findFeeds(
  principal: ApiPrincipal,
  args: FindFeedsArgs
): Promise<{ feeds: Array<FeedCandidate>; mode: "topic" | "url" }> {
  const limit = Math.min(Math.max(args.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)

  if (!args.topic && !args.url) {
    throw invalidArgument(
      "Give either a topic to search for, or a site URL to scan."
    )
  }

  const subscribed = await subscribedUrls(principal)
  const mark = (
    c: Omit<FeedCandidate, "already_subscribed">
  ): FeedCandidate => ({
    ...c,
    already_subscribed: subscribed.has(feedUrlKey(c.url)),
  })

  if (args.url) {
    return {
      mode: "url",
      feeds: (await fromUrl(principal, args.url, limit)).map(mark),
    }
  }
  return {
    mode: "topic",
    feeds: (await fromCatalogue(args.topic!, limit)).map(mark),
  }
}

/** Feed URLs already in this workspace, normalised for comparison. */
async function subscribedUrls(principal: ApiPrincipal): Promise<Set<string>> {
  const rows = await db
    .select({ url: feeds.url })
    .from(feeds)
    .where(feedInWorkspace(principal.workspaceId))
  return new Set(rows.map((r) => feedUrlKey(r.url)))
}

/**
 * Ranked catalogue search.
 *
 * Deliberately a plain scored match rather than anything clever: the catalogue
 * is a few hundred hand-curated rows, so an exact-name hit beating a
 * description mention is the whole of the requirement, and a scoring pass over
 * an in-memory array costs nothing.
 */
async function fromCatalogue(
  topic: string,
  limit: number
): Promise<Array<Omit<FeedCandidate, "already_subscribed">>> {
  const categories = await readCatalogue()
  const terms = topic.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []

  const scored: Array<{
    score: number
    candidate: Omit<FeedCandidate, "already_subscribed">
  }> = []

  for (const category of categories) {
    for (const card of category.cards) {
      const entries =
        card.kind === "feed"
          ? [card]
          : card.feeds.map((f) => ({ ...f, kind: "feed" as const }))

      for (const feed of entries) {
        const haystack =
          `${feed.name} ${feed.description} ${category.name}`.toLowerCase()
        let score = 0
        for (const term of terms) {
          if (feed.name.toLowerCase().includes(term)) score += 3
          else if (category.name.toLowerCase().includes(term)) score += 2
          else if (haystack.includes(term)) score += 1
        }
        if (score === 0) continue

        scored.push({
          score,
          candidate: {
            source_kind: feed.sourceKind ?? "rss",
            verification: "cached",
            url: feed.feedUrl,
            title: feed.name,
            description: feed.description,
            site_url: feed.siteUrl,
            sample_titles: [],
            item_count: feed.articleCount,
            source: "catalogue",
            category: category.name,
            slug: feed.slug,
          },
        })
      }
    }
  }

  const top = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.candidate)

  return await withCachedHeadlines(top)
}

/**
 * Fills in `sample_titles` for catalogue hits from the preview cache.
 *
 * These used to come back empty, which made a suggestion card a name and a
 * sentence — not enough to judge a source, which is the entire question the
 * card exists to answer. The headlines are already sitting in
 * `catalogue_articles`, written by the Discover previews.
 *
 * A miss is fine and common: the table only holds feeds someone has looked
 * inside. The card falls back to what it had before rather than making the
 * caller wait on a fetch it did not ask for.
 */
async function withCachedHeadlines(
  candidates: Array<Omit<FeedCandidate, "already_subscribed">>
): Promise<Array<Omit<FeedCandidate, "already_subscribed">>> {
  const slugs = candidates
    .map((c) => c.slug)
    .filter((s): s is string => Boolean(s))
  if (slugs.length === 0) return candidates

  const rows = await db
    .select({
      feedSlug: catalogueArticles.feedSlug,
      title: catalogueArticles.title,
      sortOrder: catalogueArticles.sortOrder,
    })
    .from(catalogueArticles)
    .where(inArray(catalogueArticles.feedSlug, slugs))
    .catch(() => [])

  if (rows.length === 0) return candidates

  const bySlug = new Map<string, Array<{ title: string; sortOrder: number }>>()
  for (const row of rows) {
    const list = bySlug.get(row.feedSlug)
    if (list) list.push(row)
    else bySlug.set(row.feedSlug, [row])
  }

  return candidates.map((candidate) => {
    const cached = candidate.slug ? bySlug.get(candidate.slug) : undefined
    if (!cached) return candidate
    return {
      ...candidate,
      sample_titles: cached
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .slice(0, 3)
        .map((r) => r.title),
    }
  })
}

/**
 * Live resolution of a site or feed URL, plus its section feeds.
 *
 * `resolveFeed` and `discoverMoreFeeds` both go through `safeFetch`, which
 * enforces the private-address blocklist and the response size cap, so a
 * caller-supplied URL cannot be turned into an SSRF probe.
 */
async function fromUrl(
  principal: ApiPrincipal,
  url: string,
  limit: number
): Promise<Array<Omit<FeedCandidate, "already_subscribed">>> {
  if (principal.demo) {
    throw invalidArgument("Scanning a site for feeds is disabled in demo mode.")
  }

  let primary
  try {
    primary = await resolveFeed(url)
  } catch (err) {
    // BlockedUrlError and friends carry messages meant for a human.
    throw upstreamFailed(
      err instanceof Error ? err.message : "Could not reach that URL."
    )
  }

  const out: Array<Omit<FeedCandidate, "already_subscribed">> = []
  if (primary) {
    out.push({
      source_kind: "rss",
      verification: "live",
      url: primary.url,
      title: primary.title ?? primary.url,
      description: null,
      site_url: originOf(primary.url),
      sample_titles: primary.sampleTitles.slice(0, 3),
      item_count: primary.itemCount,
      source: "site",
      category: null,
      slug: null,
    })
  }

  if (out.length < limit) {
    const origin = originOf(primary?.url ?? url)
    if (origin) {
      const more = await discoverMoreFeeds({
        origin,
        anchorUrl: primary?.url ?? url,
        known: out.map((f) => f.url),
      }).catch(() => [])

      for (const f of more) {
        if (out.length >= limit) break
        if (
          out.some((existing) => feedUrlKey(existing.url) === feedUrlKey(f.url))
        )
          continue
        out.push({
          url: f.url,
          title: f.title ?? f.url,
          description: f.section ? `Section: ${f.section}` : null,
          site_url: origin,
          sample_titles: f.sampleTitles.slice(0, 3),
          item_count: f.itemCount,
          source: "site",
          category: null,
          slug: null,
        })
      }
    }
  }

  if (out.length === 0) {
    const page = await inspectWebsite(url).catch(() => null)
    if (!page)
      throw upstreamFailed(
        `No feed or readable article listing found at ${url}.`
      )
    out.push({
      url: page.url,
      title: page.title,
      description: "Website source",
      site_url: originOf(page.url),
      sample_titles: page.sampleTitles,
      item_count: page.itemCount,
      source: "site",
      source_kind: "page",
      verification: "live",
      quality: page.quality,
      last_published_at: page.signals.lastPublishedAt,
      category: null,
      slug: null,
    })
  }
  return out
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

// No duplicate-check helper is exported here on purpose: the write path goes
// through `addRssFeed`, whose `findDuplicateFeed` is already workspace-scoped.
// A second, unscoped "is this URL taken" check would be both redundant and a
// cross-tenant leak — it would reveal that another workspace subscribes to a
// given feed.
