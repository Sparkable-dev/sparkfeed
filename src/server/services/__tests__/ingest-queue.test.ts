import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The queue holds a detached promise, which is the single most dangerous thing
 * in the Discover feature: an unhandled rejection kills the Node process, and a
 * counter that is not decremented on a throw wedges the queue below its own
 * concurrency limit for the life of that process — every later import then
 * silently does nothing, with no error anywhere.
 *
 * Neither failure is visible by reading the code, and neither is caught by
 * typechecking, so both are asserted here.
 */

/*
  `ingestSource` is the seam, not `ingestSource`. The queue dispatches
  on the source's kind now — a feed is read with FeedSmith, a watched page by
  parsing its listing — and what is being tested here is the draining, which is
  the same either way.
*/
const ingestSource = vi.hoisted(() => vi.fn())
vi.mock("@/server/utils/fetch-page-articles", () => ({ ingestSource }))

const { enqueueIngest, ingestFeeds, ingestQueueState, waitForIngestIdle } =
  await import("../ingest-queue")

const task = (n: number) => ({
  feedId: `feed-${n}`,
  url: `https://example.com/${n}/rss`,
})

beforeEach(async () => {
  await waitForIngestIdle().catch(() => {})
  ingestSource.mockReset()
})

describe("ingest queue", () => {
  it("shares in-flight imports with manual and automatic refresh requests", async () => {
    ingestSource.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      return { inserted: 3, skipped: 0, failed: 0 }
    })
    enqueueIngest([task(1)])
    const results = await Promise.all([
      ingestFeeds([task(1)]),
      ingestFeeds([task(1), task(1)]),
    ])
    expect(ingestSource).toHaveBeenCalledOnce()
    expect(results).toEqual([
      { inserted: 3, failed: 0, refreshed: 1 },
      { inserted: 3, failed: 0, refreshed: 1 },
    ])
  })

  it("returns failed-source counts including partial ingestion failures", async () => {
    ingestSource
      .mockRejectedValueOnce(new Error("unreachable"))
      .mockResolvedValueOnce({ inserted: 2, skipped: 0, failed: 1 })
      .mockResolvedValueOnce({ inserted: 4, skipped: 0, failed: 0 })
    expect(await ingestFeeds([task(1), task(2), task(3)])).toEqual({
      inserted: 6,
      failed: 2,
      refreshed: 3,
    })
    expect(ingestQueueState().inFlight).toBe(0)
  })
  it("runs every queued task", async () => {
    ingestSource.mockResolvedValue({ inserted: 1, skipped: 0, failed: 0 })

    enqueueIngest([task(1), task(2), task(3)])
    await waitForIngestIdle()

    expect(ingestSource).toHaveBeenCalledTimes(3)
  })

  it("never exceeds its concurrency limit", async () => {
    let active = 0
    let peak = 0
    ingestSource.mockImplementation(async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 20))
      active--
      return { inserted: 0, skipped: 0, failed: 0 }
    })

    enqueueIngest(Array.from({ length: 12 }, (_, i) => task(i)))
    await waitForIngestIdle()

    expect(peak).toBeLessThanOrEqual(4)
    expect(ingestSource).toHaveBeenCalledTimes(12)
  })

  it("survives a task that rejects, and keeps draining", async () => {
    ingestSource
      .mockRejectedValueOnce(new Error("feed is down"))
      .mockResolvedValue({ inserted: 1, skipped: 0, failed: 0 })

    enqueueIngest([task(1), task(2), task(3)])
    await waitForIngestIdle()

    expect(ingestSource).toHaveBeenCalledTimes(3)
    // The counter must come back to zero, or the queue is wedged forever.
    expect(ingestQueueState()).toEqual({ running: 0, pending: 0, inFlight: 0 })
  })

  it("survives a task that throws synchronously", async () => {
    ingestSource.mockImplementation(() => {
      throw new Error("thrown before any await")
    })

    enqueueIngest([task(1), task(2)])
    await waitForIngestIdle()

    expect(ingestQueueState().running).toBe(0)
  })

  it("does not queue the same feed twice at once", async () => {
    ingestSource.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 30))
      return { inserted: 0, skipped: 0, failed: 0 }
    })

    // An import racing a manual refresh, or a double-click.
    enqueueIngest([task(1), task(1), task(1)])
    await waitForIngestIdle()

    expect(ingestSource).toHaveBeenCalledTimes(1)
  })

  it("allows the same feed again once it has finished", async () => {
    ingestSource.mockResolvedValue({ inserted: 0, skipped: 0, failed: 0 })

    enqueueIngest([task(1)])
    await waitForIngestIdle()
    enqueueIngest([task(1)])
    await waitForIngestIdle()

    expect(ingestSource).toHaveBeenCalledTimes(2)
  })
})
