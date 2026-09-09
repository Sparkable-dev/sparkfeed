import { describe, expect, it } from "vitest"
import { FEED_REFRESH_AFTER_MS, feedNeedsRefresh } from "./feed-freshness"

const now = Date.parse("2026-09-09T12:00:00Z")
const ago = (ms: number) => new Date(now - ms).toISOString()

describe("feed freshness", () => {
  it("refreshes never-fetched and invalid timestamps", () => {
    expect(feedNeedsRefresh({}, now)).toBe(true)
    expect(feedNeedsRefresh({ lastFetchedAt: "invalid" }, now)).toBe(true)
  })
  it("requires more than one hour, not exactly one hour", () => {
    expect(
      feedNeedsRefresh({ lastFetchedAt: ago(FEED_REFRESH_AFTER_MS) }, now)
    ).toBe(false)
    expect(
      feedNeedsRefresh({ lastFetchedAt: ago(FEED_REFRESH_AFTER_MS + 1) }, now)
    ).toBe(true)
    expect(feedNeedsRefresh({ lastFetchedAt: ago(10_000) }, now)).toBe(false)
  })
  it("backs off failures without changing the last-success time", () => {
    expect(
      feedNeedsRefresh(
        {
          lastFetchedAt: ago(2 * FEED_REFRESH_AFTER_MS),
          lastErrorAt: ago(10_000),
        },
        now
      )
    ).toBe(false)
    expect(
      feedNeedsRefresh({ lastErrorAt: ago(FEED_REFRESH_AFTER_MS + 1) }, now)
    ).toBe(true)
  })
  it("skips paused sources and future timestamps", () => {
    expect(feedNeedsRefresh({ entitlementPausedAt: ago(1) }, now)).toBe(false)
    expect(feedNeedsRefresh({ lastFetchedAt: ago(-1_000) }, now)).toBe(false)
  })
})
