import { describe, expect, it, vi } from "vitest"
import { nextListingPage } from "../page-feed"

const pages = new Map<string, string>()
vi.mock("../fetch", () => ({
  safeFetchText: async (url: string) => {
    if (!pages.has(url)) throw new Error("unreachable")
    return { res: { ok: true }, text: pages.get(url), finalUrl: url }
  },
}))
vi.mock("@/db/index", () => ({ db: {} }))
const { collectPageArticles } = await import("../fetch-page-articles")
const base = "https://example.com/blog/"
const listing = (ids: Array<number>, next = "") =>
  ids
    .map(
      (i) =>
        `<a href="/blog/actual-story-${i}"><h3>Real story number ${i}</h3></a>`
    )
    .join("") + next

describe("bounded archive discovery", () => {
  it("follows same-section next links and rejects offsite/credential links", () => {
    expect(nextListingPage('<a href="?page=2">Next</a>', base)).toBe(
      base + "?page=2"
    )
    for (const href of [
      "https://evil.test/blog/?page=2",
      "https://user:pass@example.com/blog/?page=2",
      "javascript:alert(1)",
      "/account",
      "#more",
    ])
      expect(nextListingPage(`<a href="${href}">Next</a>`, base)).toBeNull()
  })
  it("deduplicates featured stories and stops pagination loops", async () => {
    pages.clear()
    pages.set(base, listing([1, 2, 3], '<a href="?page=2">Next</a>'))
    pages.set(base + "?page=2", listing([1, 4, 5], '<a href="/blog/">Next</a>'))
    const result = await collectPageArticles(base, 5)
    expect(result.items).toHaveLength(5)
    expect(result.pages).toBe(2)
    expect(result.nextUrl).toBeNull()
  })
  it("keeps earlier results when a later page fails, with a retry cursor", async () => {
    pages.clear()
    pages.set(base, listing([1, 2, 3], '<a href="?page=2">Next</a>'))
    const result = await collectPageArticles(base, 5)
    expect(result.items).toHaveLength(3)
    expect(result.nextUrl).toBe(base + "?page=2")
    expect(result.reason).toContain("could not be read")
  })
  it("caps page work and leaves a continuation", async () => {
    pages.clear()
    pages.set(base, listing([1, 2, 3], '<a href="?page=2">Next</a>'))
    const result = await collectPageArticles(base, 1)
    expect(result.pages).toBe(1)
    expect(result.nextUrl).toBe(base + "?page=2")
  })
})
