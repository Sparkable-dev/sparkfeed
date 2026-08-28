import { resolveFeed } from "../utils/detectRSS"
import { mapWithConcurrency } from "../utils/concurrency"
import { emptySignals } from "../utils/feed-signals"
import { feedError, toFeedError } from "../utils/feed-errors"
import type { ResolvedFeed } from "../utils/detectRSS"
import type { FeedError } from "../utils/feed-errors"
import type { FeedSignals } from "../utils/feed-signals"

/**
 * Resolves a handful of pasted URLs at once.
 *
 * The bulk tab's check step. Each URL is independent, so one dead address
 * cannot take the batch down with it — a failure is a *result*, reported on its
 * own row, not an exception. That is the whole reason this exists rather than a
 * `Promise.all` at the call site.
 *
 * Order is preserved so the caller can line results up against what the user
 * typed without matching on strings.
 *
 * Batches are small by design. The client sends them a few at a time and
 * appends results as they land, which keeps each request short and gives the
 * user a progress bar for free — much simpler than streaming forty URLs down
 * one response.
 */

/** Simultaneous outbound resolutions. Each may fan out to several probes. */
const CONCURRENCY = 4

/**
 * Wall-clock ceiling for one batch.
 *
 * `resolveFeed` has its own 20s budget per URL, so a batch of dead addresses
 * could otherwise sit for well over a minute. Anything not started by the time
 * this passes is reported as a timeout rather than left to hang.
 */
const BATCH_BUDGET_MS = 25_000

export interface BatchResolution {
  /** Exactly what the user typed, so the row can be labelled before it resolves. */
  input: string
  feed: {
    url: string
    title: string | null
    itemCount: number
    sampleTitles: Array<string>
    signals: FeedSignals
  } | null
  error: FeedError | null
}

export async function resolveFeedBatch(urls: Array<string>): Promise<Array<BatchResolution>> {
  const startedAt = Date.now()

  return mapWithConcurrency(urls, CONCURRENCY, async (input): Promise<BatchResolution> => {
    if (Date.now() - startedAt > BATCH_BUDGET_MS) {
      return { input, feed: null, error: feedError("timeout") }
    }

    let resolved: ResolvedFeed | null
    try {
      resolved = await resolveFeed(input)
    } catch (err) {
      return { input, feed: null, error: toFeedError(err) }
    }

    if (!resolved) {
      return { input, feed: null, error: feedError("not_a_feed") }
    }

    return {
      input,
      feed: {
        url: resolved.url,
        title: resolved.title,
        itemCount: resolved.itemCount,
        sampleTitles: resolved.sampleTitles,
        signals: resolved.signals,
      },
      error: null,
    }
  })
}

/** Signals for a row that never resolved, so the renderer has no special case. */
export { emptySignals }
