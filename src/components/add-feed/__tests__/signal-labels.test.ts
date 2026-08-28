import { describe, expect, it } from "vitest"
import { cadenceLabel, feedPath, lastPostLabel, metaParts, signalLabels } from "../signal-labels"
import { feedSignals } from "@/server/utils/feed-signals"

/**
 * The one muted line under a feed's name.
 *
 * Worth pinning because the whole design decision lives here: a row is two
 * lines, warnings come first, and what does not fit is still reachable. Get the
 * ordering wrong and a stale comments feed reads as "summaries · 2 a week".
 */

const NOW = Date.parse("2026-08-11T12:00:00.000Z")
const DAY = 86_400_000
const ago = (days: number) => new Date(NOW - days * DAY).toISOString()

function signals(over: {
  url?: string
  title?: string | null
  items?: Array<Record<string, unknown>>
}) {
  const url = over.url ?? "https://example.com/feed"
  return feedSignals({
    requestedUrl: url,
    finalUrl: url,
    feed: { title: over.title ?? "Example", items: over.items ?? [] },
    now: NOW,
  })
}

const posts = (count: number, days: number) =>
  Array.from({ length: count }, (_, i) => ({ title: `Post ${i}`, isoDate: ago(i * days) }))

describe("lastPostLabel", () => {
  it("counts days up to a month, then names the month", () => {
    // Past a month a relative number stops meaning anything and a date starts
    // meaning a lot.
    expect(lastPostLabel(signals({ items: [{ isoDate: ago(0) }] }))).toBe("today")
    expect(lastPostLabel(signals({ items: [{ isoDate: ago(3) }] }))).toBe("3d ago")
    expect(lastPostLabel(signals({ items: [{ isoDate: ago(400) }] }))).toMatch(/2025/)
  })

  it("says nothing when nothing is dated", () => {
    expect(lastPostLabel(signals({ items: [{ title: "Undated" }] }))).toBeNull()
  })
})

describe("cadenceLabel", () => {
  it("says nothing rather than '0 a week'", () => {
    // Coding Horror posts a handful of times a year, which rounds to 0.0. A
    // rate of zero beside a post from last month reads as a bug.
    expect(cadenceLabel(0)).toBeNull()
    expect(cadenceLabel(null)).toBeNull()
    expect(cadenceLabel(0.4)).toBe("0.4 a week")
    expect(cadenceLabel(26)).toBe("26 a week")
  })
})

describe("metaParts", () => {
  it("leads with the problem and keeps the facts after it", () => {
    const { parts } = metaParts(
      signals({ url: "https://x.com/comments/feed/", items: posts(6, 2) }),
      false,
    )
    expect(parts[0].text).toBe("Comments")
    expect(parts[0].tone).toBe("warn")
    // 6 posts across a 10-day span → 4.2 a week.
    expect(parts.map((p) => p.text)).toContain("4 a week")
  })

  it("spells out the date that makes a feed quiet", () => {
    // "Quiet · Mar 2025" reads as two disconnected facts; the sentence is the
    // argument against subscribing.
    const { parts } = metaParts(
      signals({ items: [{ isoDate: ago(400) }, { isoDate: ago(500) }] }),
      false,
    )
    expect(parts[0].text).toBe("Quiet")
    expect(parts[1].text).toMatch(/^nothing since /)
  })

  it("says only 'Already added' for a feed you have", () => {
    // Cadence and freshness are decision-support for a decision already made.
    const { parts } = metaParts(signals({ items: posts(6, 2) }), true)
    expect(parts).toHaveLength(1)
    expect(parts[0].text).toBe("Already added")
  })

  it("caps the line and hands the rest back for a tooltip", () => {
    // A feed can legitimately trip four signals at once, and a row that wraps
    // to three lines is the clutter this replaced.
    const { parts, hidden } = metaParts(
      signals({
        url: "http://x.com/comments/feed/",
        items: [{ isoDate: ago(400), content: "short" }, { isoDate: ago(500), content: "short" }],
      }),
      false,
    )
    expect(parts).toHaveLength(3)
    expect(hidden.length).toBeGreaterThan(0)
  })

  it("mentions full text only when it is actually full", () => {
    const long = "x".repeat(1200)
    const full = metaParts(
      signals({ items: [{ isoDate: ago(1), "content:encoded": long }, { isoDate: ago(3), "content:encoded": long }] }),
      false,
    )
    expect(full.parts.map((p) => p.text)).toContain("full text")

    const unknown = metaParts(signals({ items: posts(4, 1) }), false)
    expect(unknown.parts.map((p) => p.text)).not.toContain("full text")
  })
})

describe("signalLabels", () => {
  it("explains a comments feed rather than just naming it", () => {
    const [label] = signalLabels(
      signals({ url: "https://x.com/comments/feed/", items: posts(4, 1) }),
      false,
    )
    expect(label.text).toBe("Comments")
    expect(label.title).toMatch(/comments/i)
  })
})

describe("feedPath", () => {
  it("returns the part that tells two section feeds apart", () => {
    expect(feedPath("https://example.com/on-the-issues/feed/")).toBe("/on-the-issues/feed/")
    expect(feedPath("https://example.com/?feed=rss2")).toBe("/?feed=rss2")
  })

  it("says nothing for a bare origin or an unparseable address", () => {
    expect(feedPath("https://example.com/")).toBeNull()
    expect(feedPath("nonsense")).toBeNull()
  })
})
