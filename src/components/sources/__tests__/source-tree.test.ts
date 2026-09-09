import { describe, expect, it } from "vitest"
import {
  UNGROUPED_ID,
  buildTree,
  moveFeed,
  moveWithin,
  signature,
  toOrderPayload,
} from "../source-tree"
import type { FeedRow, FolderRow } from "@/lib/rss-types"

/**
 * The reorder maths, tested without rendering anything.
 *
 * Worth isolating because every bug here is silent: a drag that lands one index
 * off, or an Ungrouped bucket that serialises as a folder id, still renders
 * perfectly and just writes the wrong arrangement.
 */

const FOLDERS: Array<FolderRow> = [
  { id: "f1", name: "One" },
  { id: "f2", name: "Two" },
]

const FEEDS: Array<FeedRow> = [
  { id: "a", name: "A", url: "https://a.example", folderId: "f1" },
  { id: "b", name: "B", url: "https://b.example", folderId: "f1" },
  { id: "c", name: "C", url: "https://c.example", folderId: null },
]

const tree = () => buildTree(FOLDERS, FEEDS, {})

describe("buildTree", () => {
  it("nests feeds under their folder and puts the rest in Ungrouped, last", () => {
    const result = tree()

    expect(result.map((f) => f.id)).toEqual(["f1", "f2", UNGROUPED_ID])
    expect(result[0].feeds.map((f) => f.id)).toEqual(["a", "b"])
    expect(result[1].feeds).toEqual([])
    expect(result[2].feeds.map((f) => f.id)).toEqual(["c"])
  })

  it("keeps the Ungrouped bucket even when nothing is in it", () => {
    // It is the only drop target that takes a feed out of every folder, so it
    // cannot come and go with its contents.
    const result = buildTree(FOLDERS, [FEEDS[0]], {})
    expect(result.at(-1)).toMatchObject({ id: UNGROUPED_ID, feeds: [] })
  })

  it("routes a folderless feed to its standalone page", () => {
    const result = tree()
    expect(result[0].feeds[0].href).toBe("/one/a")
    expect(result[2].feeds[0].href).toBe("/feed/c")
  })
})

describe("toOrderPayload", () => {
  it("sends Ungrouped as a null folder and omits it from the folder list", () => {
    const payload = toOrderPayload(tree())

    expect(payload.folders).toEqual(["f1", "f2"])
    expect(payload.feeds).toEqual([
      { id: "a", folderId: "f1" },
      { id: "b", folderId: "f1" },
      { id: "c", folderId: null },
    ])
  })
})

describe("moveFeed", () => {
  it("moves a feed into another folder", () => {
    const next = moveFeed(tree(), "a", 1, 0)

    expect(next[0].feeds.map((f) => f.id)).toEqual(["b"])
    expect(next[1].feeds.map((f) => f.id)).toEqual(["a"])
  })

  it("reorders within a folder", () => {
    const next = moveFeed(tree(), "b", 0, 0)
    expect(next[0].feeds.map((f) => f.id)).toEqual(["b", "a"])
  })

  it("moves a feed out to Ungrouped and back", () => {
    const out = moveFeed(tree(), "a", 2, 0)
    expect(out[2].feeds.map((f) => f.id)).toEqual(["a", "c"])

    const back = moveFeed(out, "a", 0, 0)
    expect(back[0].feeds.map((f) => f.id)).toEqual(["a", "b"])
    expect(back[2].feeds.map((f) => f.id)).toEqual(["c"])
  })

  it("returns the same array for a no-op, so callers can skip the save", () => {
    const start = tree()
    expect(moveFeed(start, "a", 0, 0)).toBe(start)
    expect(moveFeed(start, "nope", 0, 0)).toBe(start)
  })

  it("clamps an index past the end rather than leaving a hole", () => {
    const next = moveFeed(tree(), "c", 0, 99)
    expect(next[0].feeds.map((f) => f.id)).toEqual(["a", "b", "c"])
  })

  it("does not mutate the tree it was given", () => {
    const start = tree()
    moveFeed(start, "a", 1, 0)
    expect(start[0].feeds.map((f) => f.id)).toEqual(["a", "b"])
  })
})

describe("signature", () => {
  it("changes when a feed moves and not otherwise", () => {
    const start = tree()
    expect(signature(moveFeed(start, "a", 0, 0))).toBe(signature(start))
    expect(signature(moveFeed(start, "a", 1, 0))).not.toBe(signature(start))
  })

  it("distinguishes a folder reorder", () => {
    const start = tree()
    const swapped = moveWithin(start, 0, 1)
    expect(signature(swapped)).not.toBe(signature(start))
  })
})
