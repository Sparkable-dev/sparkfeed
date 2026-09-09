import { beforeEach, describe, expect, it, vi } from "vitest"
import { feedSignals } from "../../utils/feed-signals"

/**
 * The bulk tab's check step.
 *
 * `resolveFeed` is stubbed: what matters here is not whether feed parsing works
 * but that fifteen independent URLs stay independent. The failure this guards
 * against is the obvious one — a `Promise.all` where one rejection loses every
 * other result — and the subtle one, results arriving out of order so a row
 * gets labelled with another row's feed.
 */

const behaviour = new Map<string, "ok" | "miss" | "throw" | "slow">()

vi.mock("../../utils/detectRSS", () => ({
  resolveFeed: async (input: string) => {
    const how = behaviour.get(input) ?? "ok"
    if (how === "throw") throw new Error("Failed query: boom")
    if (how === "miss") return null
    if (how === "slow") await new Promise((r) => setTimeout(r, 30))
    return {
      url: `${input}/feed`,
      title: `Title for ${input}`,
      itemCount: 3,
      sampleTitles: ["One"],
      publishedDates: [],
      signals: feedSignals({
        requestedUrl: input,
        finalUrl: `${input}/feed`,
        feed: { title: `Title for ${input}`, items: [{ title: "One" }] },
      }),
    }
  },
}))

const { resolveFeedBatch } = await import("../feed-resolve-batch")

beforeEach(() => behaviour.clear())

describe("resolveFeedBatch", () => {
  it("keeps results lined up with what was typed", async () => {
    // The rows are rendered against the user's input, so a reordered result
    // would put one site's feed under another site's name.
    behaviour.set("https://b.example", "slow")
    const results = await resolveFeedBatch([
      "https://a.example",
      "https://b.example",
      "https://c.example",
    ])

    expect(results.map((r) => r.input)).toEqual([
      "https://a.example",
      "https://b.example",
      "https://c.example",
    ])
    expect(results[1].feed?.url).toBe("https://b.example/feed")
  })

  it("reports a failure as a row, not an exception", async () => {
    behaviour.set("https://dead.example", "throw")
    behaviour.set("https://nofeed.example", "miss")

    const results = await resolveFeedBatch([
      "https://ok.example",
      "https://dead.example",
      "https://nofeed.example",
    ])

    expect(results[0].feed).toBeTruthy()
    expect(results[0].error).toBeNull()

    // One dead address out of three must not lose the other two.
    expect(results[1].feed).toBeNull()
    expect(results[1].error?.code).toBeTruthy()
    expect(results[2].error?.code).toBe("not_a_feed")
  })

  it("never leaks an internal message", async () => {
    // The thrown message here is a Drizzle-shaped string on purpose.
    behaviour.set("https://dead.example", "throw")
    const [result] = await resolveFeedBatch(["https://dead.example"])
    expect(result.error?.message).not.toContain("Failed query")
  })

  it("carries the signals through, so rows can be badged", async () => {
    const [result] = await resolveFeedBatch(["https://a.example"])
    expect(result.feed?.signals.identity).toContain("title for")
  })

  it("handles a single URL and an unusually large batch alike", async () => {
    expect(await resolveFeedBatch(["https://a.example"])).toHaveLength(1)
    const many = Array.from({ length: 12 }, (_, i) => `https://s${i}.example`)
    const results = await resolveFeedBatch(many)
    expect(results).toHaveLength(12)
    expect(results.every((r) => r.feed)).toBe(true)
  })
})
