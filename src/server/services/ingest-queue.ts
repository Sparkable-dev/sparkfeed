/**
 * A small in-process queue for "fetch these feeds, but don't make the user wait".
 *
 * There is no job infrastructure in this app. `src/server/plugins/cron.ts`
 * exists but has never run — `vite.config.ts` registers only `demo-boot.ts`, and
 * the comment there records that anything unlisted silently does nothing. There
 * is no queue, no waitUntil and no job table.
 *
 * What there is: Railway runs `node .output/server/index.mjs` as a long-lived
 * process, so a promise the request handler does not await keeps running after
 * the response is sent. `demo-boot.ts` already relies on this at boot; this is
 * the same trick, per request.
 *
 * What that buys, and what it does not:
 *
 *   ✓ survives the user navigating away, closing the tab, quitting the browser
 *   ✓ bounded, so one import cannot saturate the process
 *   ✗ does not survive a deploy or a restart — in-flight work is simply lost
 *   ✗ no retry, no dead-letter, no visibility once the process is gone
 *
 * That is acceptable only because the unit of work is "fetch some RSS", nothing
 * rolls back on failure, and recovery is a button the user already has
 * (`refreshFolder`). It would not be acceptable for anything with side effects
 * outside this database.
 */
import { ingestSource } from "@/server/utils/fetch-page-articles"

/**
 * Feeds are fetched at most this many at a time.
 *
 * Not a nicety. `fetchAndInsertArticles` scrapes up to 40 og:image URLs per feed
 * at concurrency 5, so an eight-feed collection run unbounded is 40 concurrent
 * outbound sockets, and three users importing at once is 120.
 */
const CONCURRENCY = 4

export interface IngestTask {
  feedId: string
  url: string
  /**
   * `rss` or `page`. Optional so existing callers keep working; anything other
   * than `page` is read as a feed, which is the safe default.
   */
  kind?: string | null
}

/** Feed ids currently queued or running, so the same feed is never fetched twice at once. */
const inFlight = new Set<string>()
const pending: Array<IngestTask> = []
let running = 0

/**
 * Queues feeds for fetching and returns immediately.
 *
 * Deliberately returns void rather than a promise: nothing should be able to
 * accidentally await this and turn a fast request back into a slow one.
 */
export function enqueueIngest(tasks: Array<IngestTask>): void {
  for (const task of tasks) {
    if (inFlight.has(task.feedId)) continue
    inFlight.add(task.feedId)
    pending.push(task)
  }
  drain()
}

function drain(): void {
  while (running < CONCURRENCY && pending.length > 0) {
    const task = pending.shift()!
    running++
    void runTask(task)
  }
}

/**
 * Runs one task and always schedules the next.
 *
 * This function must never reject. An unhandled rejection from a detached
 * promise terminates the Node process by default, which would turn a single
 * unreachable feed into an outage. The try/finally is equally load-bearing: if
 * the counter is not decremented on a throw, the queue wedges below its own
 * concurrency limit for the life of the process and every later import silently
 * stops working.
 */
async function runTask(task: IngestTask): Promise<void> {
  try {
    await ingestSource(task.feedId, task.url, task.kind ?? null)
  } catch (err) {
    // `ingestSource` already records the failure on the feed row via
    // recordFeedHealth, so this is only about not crashing.
    console.error(`[ingest] ${task.feedId} failed:`, err)
  } finally {
    running--
    inFlight.delete(task.feedId)
    drain()
  }
}

/** Exposed for tests and diagnostics only. */
export function ingestQueueState(): { running: number; pending: number; inFlight: number } {
  return { running, pending: pending.length, inFlight: inFlight.size }
}

/** Test helper: resolves once the queue has fully drained. */
export async function waitForIngestIdle(timeoutMs = 5_000): Promise<void> {
  const startedAt = Date.now()
  while (running > 0 || pending.length > 0) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("ingest queue did not drain")
    await new Promise((r) => setTimeout(r, 10))
  }
}
