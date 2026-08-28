import { describe, expect, it } from "vitest"
import { parseDrill, rank, scoreItem } from "../command-index"

const FOLDERS = [
  { id: "f1", name: "AI Research Labs" },
  { id: "f2", name: "Cloud Platforms" },
  { id: "f3", name: "Cloud Native" },
]

describe("scoreItem", () => {
  it("matches every token independently, in any order", () => {
    expect(scoreItem("goog deep", ["Google DeepMind"])).toBeGreaterThan(0)
    expect(scoreItem("deep goog", ["Google DeepMind"])).toBeGreaterThan(0)
  })

  it("rejects when any token is absent", () => {
    expect(scoreItem("goog azure", ["Google DeepMind"])).toBe(0)
  })

  it("ranks a prefix above a mere containment", () => {
    const prefix = scoreItem("open", ["OpenAI Blog"])
    const contains = scoreItem("ai", ["OpenAI Blog"])
    expect(prefix).toBeGreaterThan(contains)
  })

  it("scores a sublabel-only match below a name match", () => {
    const viaName = scoreItem("cloud", ["Cloud Platforms", "AWS"])
    const viaSublabel = scoreItem("aws", ["Cloud Platforms", "AWS"])
    expect(viaName).toBeGreaterThan(viaSublabel)
    expect(viaSublabel).toBeGreaterThan(0)
  })

  it("treats an empty query as a match, so idle lists render", () => {
    expect(scoreItem("   ", ["anything"])).toBe(1)
  })
})

describe("rank", () => {
  it("drops non-matches and orders best first", () => {
    const items = [
      { keywords: ["Meta AI Research"] },
      { keywords: ["OpenAI Blog"] },
      { keywords: ["Cloud Platforms"] },
    ]
    const out = rank(items, "openai")
    expect(out).toHaveLength(1)
    expect(out[0].keywords[0]).toBe("OpenAI Blog")
  })

  it("caps to the limit when given one", () => {
    const items = Array.from({ length: 9 }, (_, i) => ({ keywords: [`Feed ${i}`] }))
    expect(rank(items, "feed", 5)).toHaveLength(5)
    expect(rank(items, "feed")).toHaveLength(9)
  })
})

describe("parseDrill", () => {
  it("enters a folder scope and keeps what follows", () => {
    const out = parseDrill("AI Research Labs > open", FOLDERS)
    expect(out?.scope).toEqual({ kind: "folder", id: "f1", label: "AI Research Labs" })
    expect(out?.rest).toBe("open")
  })

  it("accepts an unambiguous prefix, however short", () => {
    expect(parseDrill("ai res > ", FOLDERS)?.scope.label).toBe("AI Research Labs")
    expect(parseDrill("ai >", FOLDERS)?.scope.label).toBe("AI Research Labs")
  })

  it("refuses an ambiguous prefix rather than guessing", () => {
    // "Cloud" prefixes both Cloud Platforms and Cloud Native.
    expect(parseDrill("cloud > k8s", FOLDERS)).toBeNull()
  })

  it("prefers an exact name over other folders it prefixes", () => {
    const folders = [...FOLDERS, { id: "f4", name: "Cloud" }]
    expect(parseDrill("cloud > x", folders)?.scope).toEqual({
      kind: "folder",
      id: "f4",
      label: "Cloud",
    })
  })

  it("enters a fixed scope by name", () => {
    expect(parseDrill("discover > gam", FOLDERS)?.scope).toEqual({
      kind: "fixed",
      id: "discover",
      label: "Discover",
    })
  })

  it("leaves a query with no separator alone", () => {
    expect(parseDrill("cloud platforms", FOLDERS)).toBeNull()
  })

  it("ignores a leading separator with nothing before it", () => {
    expect(parseDrill("> open", FOLDERS)).toBeNull()
  })

  it("splits on the first separator only, so a second stays in the query", () => {
    const out = parseDrill("AI Research Labs > a > b", FOLDERS)
    expect(out?.rest).toBe("a > b")
  })
})
