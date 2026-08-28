import { describe, expect, it } from "vitest"
import { feedSignals, isCommentsFeed, shouldAutoSelect } from "../feed-signals"

/**
 * Everything the Add dialog and `verify_feed` say about a candidate is decided
 * here, so this is where the judgements are pinned.
 *
 * `now` is injected throughout. A staleness rule tested against the real clock
 * passes today and fails whenever the fixture ages past a threshold, which is
 * the worst kind of test: green until it is inexplicably red months later.
 */

const NOW = Date.parse("2026-08-11T12:00:00.000Z")
const DAY = 86_400_000
const ago = (days: number) => new Date(NOW - days * DAY).toISOString()

function signals(over: {
  url?: string
  requested?: string
  title?: string | null
  items?: Array<Record<string, unknown>>
}) {
  const url = over.url ?? "https://example.com/feed"
  return feedSignals({
    requestedUrl: over.requested ?? url,
    finalUrl: url,
    feed: { title: over.title ?? "Example", items: over.items ?? [] },
    now: NOW,
  })
}

/** N items, one every `days` days, newest first. */
const posts = (count: number, days: number) =>
  Array.from({ length: count }, (_, i) => ({
    title: `Post ${i}`,
    isoDate: ago(i * days),
  }))

describe("an empty feed", () => {
  it("is reported rather than treated as a failure", () => {
    // A feed that parses and has nothing in it is legitimately subscribable —
    // a blog that has not launched yet. It is a warning, not an error, and it
    // is the only thing that ever produced the `no_items` code.
    const s = signals({ items: [] })
    expect(s.itemCount).toBe(0)
    expect(s.codes).toContain("no_items")
    expect(s.freshness).toBe("unknown")
  })
})

describe("cadence", () => {
  it("measures across the span the page covers, not the last week", () => {
    // 10 items, one every two days → about 3.5/week, rounded to 4. A feed that
    // posts monthly would report zero against a fixed seven-day window.
    expect(signals({ items: posts(10, 2) }).postsPerWeek).toBe(4)
  })

  it("keeps a decimal below one, so a monthly blog is not reported as dead", () => {
    const rate = signals({ items: posts(6, 30) }).postsPerWeek
    expect(rate).toBeGreaterThan(0)
    expect(rate).toBeLessThan(1)
  })

  it("says nothing rather than dividing by zero", () => {
    // One item, or everything on the same day: no span, and "infinite posts per
    // week" is not an answer.
    expect(signals({ items: posts(1, 0) }).postsPerWeek).toBeNull()
    expect(signals({ items: posts(4, 0) }).postsPerWeek).toBeNull()
  })

  it("ignores items with no date at all", () => {
    const s = signals({ items: [{ title: "Undated" }, { title: "Also undated" }] })
    expect(s.postsPerWeek).toBeNull()
    expect(s.lastPublishedAt).toBeNull()
    expect(s.daysSinceLastPost).toBeNull()
  })
})

describe("freshness", () => {
  it("splits fresh, slow and quiet at the documented thresholds", () => {
    expect(signals({ items: posts(5, 1) }).freshness).toBe("fresh")
    // Newest item 30 days old: alive, but not current.
    expect(signals({ items: [{ isoDate: ago(30) }, { isoDate: ago(60) }] }).freshness).toBe("slow")
    expect(signals({ items: [{ isoDate: ago(400) }, { isoDate: ago(500) }] }).freshness).toBe(
      "quiet",
    )
  })

  it("only flags the quiet ones", () => {
    expect(signals({ items: posts(5, 1) }).codes).not.toContain("quiet")
    expect(
      signals({ items: [{ isoDate: ago(400) }, { isoDate: ago(500) }] }).codes,
    ).toContain("quiet")
  })

  it("counts whole days since the newest post", () => {
    expect(signals({ items: [{ isoDate: ago(3) }] }).daysSinceLastPost).toBe(3)
  })
})

describe("comments feeds", () => {
  // The single biggest source of bad adds: WordPress advertises these in the
  // same <link rel="alternate"> block as the real feed, with a nearly identical
  // title, so they arrive looking entirely legitimate.
  it("spots the conventional path", () => {
    expect(isCommentsFeed("https://blog.example.com/comments/feed/", null)).toBe(true)
    expect(isCommentsFeed("https://blog.example.com/comments/feed", null)).toBe(true)
  })

  it("spots the query-string form", () => {
    expect(isCommentsFeed("https://example.com/?feed=comments-rss2", null)).toBe(true)
  })

  it("spots both title shapes", () => {
    expect(isCommentsFeed("https://example.com/x", "Comments on: Hello world")).toBe(true)
    expect(isCommentsFeed("https://example.com/x", "Example Blog » Comments Feed")).toBe(true)
  })

  it("does not fire on a post that merely talks about comments", () => {
    // The rule is anchored at the start of the title on purpose. A feed named
    // after an article called "Comments on the new API" is a real feed.
    expect(isCommentsFeed("https://example.com/feed", "Notes on comments and moderation")).toBe(
      false,
    )
    expect(isCommentsFeed("https://example.com/feed", "Example Blog")).toBe(false)
  })

  it("survives a URL it cannot parse", () => {
    expect(() => isCommentsFeed("not a url", "Example")).not.toThrow()
  })
})

describe("full text versus summaries", () => {
  const long = "x".repeat(1200)
  const short = "x".repeat(120)

  it("calls it full when half the sample carries whole articles", () => {
    const items = [
      { "content:encoded": long },
      { "content:encoded": long },
      { "content:encoded": short },
      { "content:encoded": short },
    ]
    expect(signals({ items }).fullText).toBe("full")
  })

  it("calls it summary only when nothing is long", () => {
    const s = signals({ items: [{ content: short }, { content: short }] })
    expect(s.fullText).toBe("summary")
    expect(s.codes).toContain("summary_only")
  })

  it("stays quiet when the mix is ambiguous", () => {
    // One verbose post out of four says nothing about the feed.
    const items = [{ content: long }, { content: short }, { content: short }, { content: short }]
    expect(signals({ items }).fullText).toBe("unknown")
  })

  it("reads an Atom feed's body out of `summary`", () => {
    // Simon Willison's feed carries no `content` at all. Without this every
    // Atom feed of that shape was reported as summary-only on the strength of
    // having looked in the wrong field.
    expect(signals({ items: [{ summary: long }, { summary: long }] }).fullText).toBe("full")
  })

  it("admits it does not know when no item carries any body", () => {
    // Saying "summaries" because we failed to find the text is a claim, not a
    // measurement.
    const s = signals({ items: [{ title: "One" }, { title: "Two" }] })
    expect(s.fullText).toBe("unknown")
    expect(s.codes).not.toContain("summary_only")
  })

  it("says nothing about an empty feed", () => {
    expect(signals({ items: [] }).fullText).toBe("unknown")
  })
})

describe("the address itself", () => {
  it("flags plain http", () => {
    expect(signals({ url: "http://example.com/feed" }).codes).toContain("insecure")
    expect(signals({ url: "https://example.com/feed" }).codes).not.toContain("insecure")
  })

  it("flags a redirect, ignoring scheme and trailing-slash noise", () => {
    expect(
      signals({ requested: "https://example.com/rss", url: "https://example.com/feed.xml" })
        .redirected,
    ).toBe(true)
    // These are the same address written two ways, not a redirect worth naming.
    expect(
      signals({ requested: "http://example.com/feed/", url: "https://example.com/feed" })
        .redirected,
    ).toBe(false)
  })
})

describe("identity", () => {
  it("collapses one feed served at several paths", () => {
    const a = signals({ url: "https://example.com/feed", items: [{ title: "First post" }] })
    const b = signals({ url: "https://example.com/rss.xml", items: [{ title: "First post" }] })
    expect(a.identity).toBe(b.identity)
  })

  it("separates genuinely different feeds", () => {
    const tech = signals({ title: "Tech | The Verge", items: [{ title: "A chip story" }] })
    const games = signals({ title: "Gaming | The Verge", items: [{ title: "A game story" }] })
    expect(tech.identity).not.toBe(games.identity)
  })

  it("is case-insensitive and survives missing fields", () => {
    expect(signals({ title: "EXAMPLE" }).identity).toBe(signals({ title: "example" }).identity)
    expect(() => signals({ title: null, items: [] })).not.toThrow()
  })
})

describe("what starts ticked", () => {
  it("ticks an ordinary feed", () => {
    expect(shouldAutoSelect(signals({ items: posts(5, 1) }), false)).toBe(true)
  })

  it("leaves a quiet feed ticked, because slow is often the point", () => {
    // "This blog posts twice a year" is frequently exactly why you subscribe.
    const quiet = signals({ items: [{ isoDate: ago(400) }, { isoDate: ago(500) }] })
    expect(quiet.freshness).toBe("quiet")
    expect(shouldAutoSelect(quiet, false)).toBe(true)
  })

  it("does not tick the unambiguous mistakes", () => {
    expect(shouldAutoSelect(signals({ items: posts(5, 1) }), true)).toBe(false)
    expect(
      shouldAutoSelect(signals({ url: "https://x.com/comments/feed/", items: posts(5, 1) }), false),
    ).toBe(false)
    expect(shouldAutoSelect(signals({ items: [] }), false)).toBe(false)
  })
})

describe("code ordering", () => {
  it("puts the most severe first, so a row leads with what matters", () => {
    const s = signals({
      url: "http://x.com/comments/feed/",
      title: "Comments on: Hello",
      items: [],
    })
    expect(s.codes[0]).toBe("no_items")
    expect(s.codes).toEqual(["no_items", "comments_feed", "insecure"])
  })
})
