import { feedUrlKey, normalizeFeedUrl } from "./validation"

/**
 * Turns whatever someone pasted into a list of addresses worth checking.
 *
 * People do not paste clean lists. They paste a column copied out of a
 * spreadsheet, a markdown bullet list, a comma-separated line from a
 * colleague's message, or an OPML export's worth of URLs wrapped in quotes.
 * All of those should work, because the alternative is a validation error that
 * blames the user for the shape of their clipboard.
 *
 * Pure and client-safe on purpose: this runs as you type, and it is also the
 * exact substrate an OPML import would sit on later.
 */

/** Bullets, list markers and quotes people paste around a URL. */
const DECORATION = /^[\s\-*•>+\d.)\]}"'`]+|[\s"'`,;]+$/g

/**
 * The three limits the bulk path is built around.
 *
 * Here rather than beside the server functions that enforce them, because the
 * client needs all three — to chunk, to cap a paste, to say what it dropped —
 * and importing a plain constant out of a `createServerFn` module pulls that
 * module's whole dependency tree into the browser bundle. That is the failure
 * `sources-write.ts` documents, and it presents as
 * `"isIP" is not exported by "__vite-browser-external"`.
 */

/**
 * URLs resolved in one round trip.
 *
 * Small because the client chunks: each request stays well inside a sensible
 * timeout and the user watches the count climb instead of a spinner.
 */
export const MAX_BATCH_URLS = 8

/**
 * Feeds one submit may add.
 *
 * 40 rather than a rounder number: `getImportStatus`, which fills in article
 * counts afterwards, accepts at most 50 ids. A batch that cannot be reported on
 * is worse than a smaller batch.
 */
export const MAX_BULK_FEEDS = 40

/**
 * Ceiling on one paste. Excess is dropped rather than refused — telling someone
 * their 60-line paste is invalid is worse than taking the first 40 and saying
 * so.
 */
export const MAX_BULK_URLS = MAX_BULK_FEEDS

export interface BulkParse {
  urls: Array<string>
  /** Lines that looked like something but could not be made into a URL. */
  rejected: Array<string>
  /** How many were dropped for being past the cap. */
  overflow: number
}

export function parseBulkInput(raw: string): BulkParse {
  const lines = raw
    // Commas split too: a single pasted line of comma-separated URLs is a
    // list, not one very strange address.
    .split(/[\n\r,]+/)
    .map((line) => line.replace(DECORATION, "").trim())
    .filter((line) => line.length > 0)

  const urls: Array<string> = []
  const rejected: Array<string> = []
  const seen = new Set<string>()
  let overflow = 0

  for (const line of lines) {
    const normalized = normalizeFeedUrl(line)
    if (!normalized) {
      rejected.push(line)
      continue
    }

    // Deduped before anything is fetched: the same site listed twice should
    // cost one request, not two, and produce one row rather than two.
    const key = feedUrlKey(normalized)
    if (seen.has(key)) continue
    seen.add(key)

    if (urls.length >= MAX_BULK_URLS) {
      overflow++
      continue
    }
    urls.push(normalized)
  }

  return { urls, rejected, overflow }
}

/** Splits a list into fixed-size chunks, for sending a few at a time. */
export function chunk<T>(items: Array<T>, size: number): Array<Array<T>> {
  const out: Array<Array<T>> = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
