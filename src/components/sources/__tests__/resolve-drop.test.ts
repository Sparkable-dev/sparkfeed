import { describe, expect, it } from "vitest"
import { resolveDrop } from "../resolve-drop"
import { UNGROUPED_ID, buildTree, signature } from "../source-tree"
import type { FeedRow, FolderRow } from "@/components/Sidebar"

/**
 * What a drop means.
 *
 * The seam between dnd-kit and the tree, and the one place a mistake is
 * invisible: a feed that lands one row off still renders perfectly and just
 * saves the wrong thing. Everything either side of this is already tested.
 */

const FOLDERS: Array<FolderRow> = [
  { id: "f1", name: "One" },
  { id: "f2", name: "Two" },
]

const FEEDS: Array<FeedRow> = [
  { id: "a", name: "A", url: "https://a.example", folderId: "f1" },
  { id: "b", name: "B", url: "https://b.example", folderId: "f1" },
  { id: "c", name: "C", url: "https://c.example", folderId: "f2" },
  { id: "d", name: "D", url: "https://d.example", folderId: null },
]

const tree = () => buildTree(FOLDERS, FEEDS, {})

const folderId = (id: string) => `folder:${id}`
const feedId = (id: string) => `feed:${id}`
const bodyId = (id: string) => `folder-body:${id}`

describe("resolveDrop", () => {
  it("reorders folders", () => {
    const next = resolveDrop(tree(), folderId("f2"), folderId("f1"))
    expect(next?.map((f) => f.id)).toEqual(["f2", "f1", UNGROUPED_ID])
  })

  it("refuses to reorder a folder onto the Ungrouped bucket", () => {
    // It is pinned last and is not a folder; letting it be a drop position
    // would put real folders below something that cannot be dragged at all.
    expect(resolveDrop(tree(), folderId("f1"), folderId(UNGROUPED_ID))).toBeNull()
  })

  it("refuses to drop a folder onto a feed", () => {
    expect(resolveDrop(tree(), folderId("f1"), feedId("c"))).toBeNull()
  })

  it("moves a feed onto another feed's position", () => {
    const next = resolveDrop(tree(), feedId("a"), feedId("c"))
    expect(next?.[0].feeds.map((f) => f.id)).toEqual(["b"])
    expect(next?.[1].feeds.map((f) => f.id)).toEqual(["a", "c"])
  })

  it("appends a feed dropped on a folder body", () => {
    const next = resolveDrop(tree(), feedId("a"), bodyId("f2"))
    expect(next?.[1].feeds.map((f) => f.id)).toEqual(["c", "a"])
  })

  it("does nothing when a feed is dropped on the folder it already lives in", () => {
    // The commonest accidental drop: hovering a folder header on the way past.
    // Sending the feed to the bottom of its own list would look like a bug.
    expect(resolveDrop(tree(), feedId("a"), bodyId("f1"))).toBeNull()
  })

  it("moves a feed out to Ungrouped and back", () => {
    const out = resolveDrop(tree(), feedId("a"), bodyId(UNGROUPED_ID))
    expect(out?.at(-1)?.feeds.map((f) => f.id)).toEqual(["d", "a"])

    const back = resolveDrop(out!, feedId("a"), bodyId("f1"))
    expect(back?.[0].feeds.map((f) => f.id)).toEqual(["b", "a"])
  })

  it("returns null for a drop that changes nothing", () => {
    expect(resolveDrop(tree(), feedId("a"), feedId("a"))).toBeNull()
    expect(resolveDrop(tree(), folderId("f1"), folderId("f1"))).toBeNull()
  })

  it("ignores ids it does not recognise", () => {
    expect(resolveDrop(tree(), "nonsense", feedId("a"))).toBeNull()
    expect(resolveDrop(tree(), feedId("a"), "nonsense")).toBeNull()
    expect(resolveDrop(tree(), feedId("a"), bodyId("missing-folder"))).toBeNull()
  })

  it("never mutates the tree it is given", () => {
    const start = tree()
    const before = signature(start)
    resolveDrop(start, feedId("a"), bodyId("f2"))
    expect(signature(start)).toBe(before)
  })
})
