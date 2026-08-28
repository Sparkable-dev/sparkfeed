import { describe, expect, it } from "vitest"
import { MAX_BULK_URLS, chunk, parseBulkInput } from "../bulk-urls"

/**
 * What people actually paste.
 *
 * Every case here came from thinking about where a list of URLs comes from: a
 * spreadsheet column, a markdown bullet list, a message from a colleague, an
 * OPML export. Rejecting any of them means blaming the user for the shape of
 * their clipboard.
 */

describe("parseBulkInput", () => {
  it("takes one address per line", () => {
    const { urls } = parseBulkInput("simonwillison.net\noverreacted.io")
    expect(urls).toEqual(["https://simonwillison.net/", "https://overreacted.io/"])
  })

  it("ignores blank lines and stray whitespace", () => {
    const { urls } = parseBulkInput("\n\n  a.example  \n\n\tb.example\n")
    expect(urls).toHaveLength(2)
  })

  it("splits a comma-separated line", () => {
    // One pasted line of comma-separated URLs is a list, not one very strange
    // address.
    const { urls } = parseBulkInput("a.example, b.example,c.example")
    expect(urls).toHaveLength(3)
  })

  it("strips markdown bullets, numbering and quotes", () => {
    const { urls } = parseBulkInput(
      ['- a.example', '* b.example', '1. c.example', '"d.example"', '> e.example'].join("\n"),
    )
    expect(urls).toHaveLength(5)
  })

  it("collapses the same address written two ways", () => {
    // Deduped before anything is fetched, so a repeat costs one request and
    // produces one row.
    const { urls } = parseBulkInput(
      "https://a.example/feed\nhttp://a.example/feed/\na.example/feed",
    )
    expect(urls).toHaveLength(1)
  })

  it("reports lines it could not read rather than dropping them silently", () => {
    const { urls, rejected } = parseBulkInput("a.example\nnot a url\nftp://x.example/feed")
    expect(urls).toHaveLength(1)
    expect(rejected).toEqual(["not a url", "ftp://x.example/feed"])
  })

  it("takes the first N and says how many it left", () => {
    // Telling someone their 60-line paste is invalid is worse than taking 40
    // and saying so.
    const many = Array.from({ length: 46 }, (_, i) => `s${i}.example`).join("\n")
    const { urls, overflow } = parseBulkInput(many)
    expect(urls).toHaveLength(MAX_BULK_URLS)
    expect(overflow).toBe(6)
  })

  it("returns nothing for nothing", () => {
    expect(parseBulkInput("").urls).toEqual([])
    expect(parseBulkInput("   \n  ").urls).toEqual([])
  })
})

describe("chunk", () => {
  it("splits into batches, last one short", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it("handles an empty list and an exact fit", () => {
    expect(chunk([], 3)).toEqual([])
    expect(chunk([1, 2], 2)).toEqual([[1, 2]])
  })
})
