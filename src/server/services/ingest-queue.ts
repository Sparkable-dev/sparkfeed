/**
 * A small in-process queue for "fetch these feeds, but don't make the user wait".
 *
 * This queue is process-local. It is shared by imports and browser refreshes.
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

type Outcome = Awaited<ReturnType<typeof ingestSource>> | null
type QueuedTask = IngestTask & { complete: (outcome: Outcome) => void }

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
  archive?: boolean
  startUrl?: string
}

/** Feed ids currently queued or running, so the same feed is never fetched twice at once. */
const inFlight = new Map<string, Promise<Outcome>>()
const pending: Array<QueuedTask> = []
let running = 0

/**
 * Queues feeds for fetching and returns immediately.
 *
 * Deliberately returns void rather than a promise: nothing should be able to
 * accidentally await this and turn a fast request back into a slow one.
 */
export function enqueueIngest(tasks: Array<IngestTask>): void {
  for (const task of tasks) void queueTask(task)
}

function queueTask(task: IngestTask): Promise<Outcome> {
  const existing = inFlight.get(task.feedId)
  if (existing) return existing
  let complete!: (outcome: Outcome) => void
  const result = new Promise<Outcome>((resolve) => {
    complete = resolve
  })
  inFlight.set(task.feedId, result)
  pending.push({ ...task, complete })
  drain()
  return result
}

/** Awaitable refresh, sharing the import queue's concurrency and in-flight work. */
export async function ingestFeeds(tasks: Array<IngestTask>) {
  const unique = [...new Map(tasks.map((task) => [task.feedId, task])).values()]
  const results = await Promise.all(unique.map(queueTask))
  return {
    inserted: results.reduce(
      (total, result) => total + (result?.inserted ?? 0),
      0
    ),
    failed: results.filter((result) => !result || result.failed > 0).length,
    refreshed: results.length,
  }
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
async function runTask(task: QueuedTask): Promise<void> {
  let outcome: Outcome = null
  try {
    outcome = await ingestSource(task.feedId, task.url, task.kind ?? null, {
      archive: task.archive,
      startUrl: task.startUrl,
    })
  } catch (err) {
    // `ingestSource` already records the failure on the feed row via
    // recordFeedHealth, so this is only about not crashing.
    console.error(`[ingest] ${task.feedId} failed:`, err)
  } finally {
    running--
    inFlight.delete(task.feedId)
    task.complete(outcome)
    drain()
  }
}

/** Exposed for tests and diagnostics only. */
export function ingestQueueState(): {
  running: number
  pending: number
  inFlight: number
} {
  return { running, pending: pending.length, inFlight: inFlight.size }
}

/** Test helper: resolves once the queue has fully drained. */
export async function waitForIngestIdle(timeoutMs = 5_000): Promise<void> {
  const startedAt = Date.now()
  while (running > 0 || pending.length > 0) {
    if (Date.now() - startedAt > timeoutMs)
      throw new Error("ingest queue did not drain")
    await new Promise((r) => setTimeout(r, 10))
  }
}

export interface ArchiveStatus {
  state: "running" | "complete" | "error"
  inserted: number
  message: string
  hasMore: boolean
}
const archives = new Map<
  string,
  { status: ArchiveStatus; nextUrl?: string; at: number }
>()

export function archiveStatus(feedId: string): ArchiveStatus | null {
  return archives.get(feedId)?.status ?? null
}

/** Uses the same per-feed lock and worker budget as normal refreshes. Restarting is safe. */
export function enqueueArchive(task: IngestTask): ArchiveStatus {
  const previous = archives.get(task.feedId)
  if (previous?.status.state === "running") return previous.status
  if (inFlight.has(task.feedId))
    throw new Error("This source is refreshing. Try again after it finishes.")
  for (const [id, entry] of archives) {
    if (entry.status.state !== "running" && Date.now() - entry.at > 60 * 60_000)
      archives.delete(id)
  }
  if (archives.size >= 1000 && !archives.has(task.feedId))
    throw new Error("Archive queue is busy. Try again later.")
  const status: ArchiveStatus = {
    state: "running",
    inserted: 0,
    hasMore: false,
    message: "Fetching older articles in the background.",
  }
  archives.set(task.feedId, { status, at: Date.now() })
  void queueTask({ ...task, archive: true, startUrl: previous?.nextUrl }).then(
    (result) => {
      archives.set(task.feedId, {
        at: Date.now(),
        nextUrl: result?.archive?.nextUrl ?? undefined,
        status: result
          ? {
              state: result.failed ? "error" : "complete",
              inserted: result.inserted,
              hasMore: !!result.archive?.nextUrl,
              message: result.failed
                ? "Some articles could not be saved. Try again later."
                : (result.archive?.reason ??
                  "No archive was fetched. Check the source access and try again."),
            }
          : {
              state: "error",
              inserted: 0,
              hasMore: false,
              message:
                "Could not read the archive. Saved articles are unchanged. Try again later.",
            },
      })
    }
  )
  return status
}
