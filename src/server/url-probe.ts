import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { resolveFeed } from "./utils/detectRSS"
import { MIN_PAGE_LINKS, extractPageLinks } from "./utils/page-feed"
import { safeFetchText } from "./utils/fetch"
import {  toFeedError } from "./utils/feed-errors"
import type {FeedError} from "./utils/feed-errors";
import { feedUrlSchema } from "@/lib/validation"

/**
 * Answers one question about a pasted URL: can this become a feed, and how?
 *
 * Three outcomes, because there are genuinely three. Most sites publish RSS and
 * simply do not advertise it; a good number of the rest are a blog page we can
 * read anyway; and some are neither, which the user is owed as a plain answer
 * rather than a spinner that never resolves.
 *
 * Writes nothing. `previewFeed` and `scrapeAndSave` both exist already, but the
 * first is workspace-scoped and demo-locked and the second *creates a source* as
 * a side effect of finding out. Neither is safe to point at a URL someone is
 * still deciding about.
 */

/** A page has to yield at least this many links to be worth calling a feed. */
/** Shared with the extractor, so the probe and the ingest agree on "enough". */
const MIN_SCRAPABLE = MIN_PAGE_LINKS
const SAMPLE_COUNT = 4
const PAGE_TIMEOUT_MS = 10_000

export type UrlProbeResult =
  | {
      status: "rss"
      url: string
      feedUrl: string
      title: string | null
      itemCount: number
      sampleTitles: Array<string>
    }
  | {
      status: "scrapable"
      url: string
      count: number
      sampleTitles: Array<string>
    }
  | { status: "none"; url: string }
  | { status: "error"; error: FeedError }

export const probeUrl = createServerFn({ method: "POST" })
  .validator(z.object({ url: feedUrlSchema }))
  .handler(async ({ data }): Promise<UrlProbeResult> => {
    /*
      Deliberately not demo-locked. This only reads a public page — the SSRF
      guard in safeFetch is what makes that safe, not the workspace check — and
      it is the single most convincing thing in the product to let a visitor
      try. Adding the result is still locked.
    */
    let resolved
    try {
      resolved = await resolveFeed(data.url)
    } catch (err) {
      return { status: "error", error: toFeedError(err) }
    }

    if (resolved) {
      return {
        status: "rss",
        url: data.url,
        feedUrl: resolved.url,
        title: resolved.title,
        itemCount: resolved.itemCount,
        sampleTitles: resolved.sampleTitles.slice(0, SAMPLE_COUNT),
      }
    }

    // No feed anywhere on the site. Fall back to reading the page itself.
    try {
      const { res, text: html } = await safeFetchText(data.url, {
        timeoutMs: PAGE_TIMEOUT_MS,
      })
      if (!res.ok) return { status: "none", url: data.url }

      const links = extractPageLinks(html, data.url)
      if (links.length >= MIN_SCRAPABLE) {
        return {
          status: "scrapable",
          url: data.url,
          count: links.length,
          sampleTitles: links.slice(0, SAMPLE_COUNT).map((l) => l.title),
        }
      }
    } catch {
      // The page was reachable enough for resolveFeed not to throw, so a failure
      // here is about this one request. "We found nothing" is the truthful
      // summary either way, and is more useful than an error code.
    }

    return { status: "none", url: data.url }
  })
