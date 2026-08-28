import { describe, expect, it } from "vitest"
import { buildOverview, quadrantOf } from "../source-stats"
import type { SourcePoint } from "../source-stats"
import type { TreeFeed, TreeFolder } from "../source-tree"
import type { SourceHealthRow } from "@/server/sources-data"

/**
 * The arithmetic behind the strip at the top of /sources.
 *
 * Isolated from the rendering because every mistake in here is a plausible
 * number. A folder total that quietly drops the unfiled bucket, or a count that
 * misses a feed the health query has not seen, still draws a chart that looks
 * entirely reasonable and is wrong.
 */

const NOW = Date.parse("2026-08-11T12:00:00.000Z")
const DAY = 24 * 60 * 60 * 1000

const ago = (days: number) => new Date(NOW - days * DAY).toISOString()

function health(over: Partial<SourceHealthRow> = {}): SourceHealthRow {
  return {
    posts30d: 30,
    firstAt30d: ago(30),
    lastAt30d: ago(0),
    lastPostAt: ago(0),
    lastError: null,
    lastErrorAt: null,
    lastFetchedAt: ago(0),
    createdAt: ago(200),
    ...over,
  }
}

function feed(id: string, over: Partial<SourceHealthRow> | null = {}): TreeFeed {
  return {
    id,
    name: id.toUpperCase(),
    url: `https://${id}.example`,
    isShared: false,
    hasPassword: false,
    health: over === null ? null : health(over),
    href: `/feed/${id}`,
    kind: "rss",
  }
}

function folder(
  id: string,
  name: string,
  feeds: Array<TreeFeed>,
  isRealFolder = true,
): TreeFolder {
  return { id, name, isRealFolder, isShared: false, hasPassword: false, href: "/", feeds }
}

describe("buildOverview", () => {
  const tree = [
    folder("f1", "Google", [feed("a", { posts30d: 100 }), feed("b", { posts30d: 20 })]),
    folder("f2", "Empty", []),
    folder("__ungrouped__", "Other feeds", [feed("c", { posts30d: 5 })], false),
  ]

  it("counts every feed, and only real folders", () => {
    const overview = buildOverview(tree, NOW)
    // Three feeds across two real folders plus the bucket, which is not one.
    expect(overview.feedCount).toBe(3)
    expect(overview.folderCount).toBe(2)
    expect(overview.posts30d).toBe(125)
  })

  it("ranks folders by volume and keeps the unfiled bucket in the ranking", () => {
    // The bucket is not a folder, but its feeds publish, and a chart of where
    // the volume comes from that omits them does not add up to the total.
    const overview = buildOverview(tree, NOW)
    expect(overview.byFolder).toEqual([
      { label: "Google", value: 120 },
      { label: "Other feeds", value: 5 },
    ])
  })

  it("leaves out a folder with nothing in it", () => {
    const overview = buildOverview(tree, NOW)
    expect(overview.byFolder.map((f) => f.label)).not.toContain("Empty")
  })

  it("sums the tail into one bar rather than dropping it", () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      folder(`f${i}`, `Folder ${i}`, [feed(`x${i}`, { posts30d: 10 - i })]),
    )
    const overview = buildOverview(many, NOW)

    expect(overview.byFolder).toHaveLength(6)
    // Five biggest kept (10…6), the other four summed.
    expect(overview.byFolder.at(-1)).toEqual({ label: "4 more folders", value: 5 + 4 + 3 + 2 })
    // Nothing is lost: the bars still account for every post counted.
    const charted = overview.byFolder.reduce((sum, bar) => sum + bar.value, 0)
    expect(charted).toBe(overview.posts30d)
  })

  it("counts a feed the health query has not seen, rather than skipping it", () => {
    const overview = buildOverview([folder("f1", "One", [feed("a", null)])], NOW)
    expect(overview.feedCount).toBe(1)
    expect(overview.byStatus.new).toBe(1)
    expect(overview.points).toHaveLength(1)
  })

  it("splits sources across the four states", () => {
    const overview = buildOverview(
      [
        folder("f1", "One", [
          feed("ok"),
          feed("dead", { lastError: "404" }),
          feed("silent", { posts30d: 3, lastPostAt: ago(90), lastAt30d: ago(90) }),
          feed("fresh", { posts30d: 0, lastPostAt: null, createdAt: ago(1) }),
        ]),
      ],
      NOW,
    )

    expect(overview.byStatus).toEqual({ active: 1, broken: 1, quiet: 1, new: 1 })
  })
})

describe("quadrantOf", () => {
  const point = (over: Partial<SourcePoint>): SourcePoint => ({
    id: "x",
    name: "X",
    posts30d: 10,
    quietDays: 0,
    status: "active",
    ...over,
  })

  it("separates a source that stopped from one that was always rare", () => {
    // The whole reason this is a plot: both have been silent for a fortnight,
    // and only one of them is a change in behaviour.
    expect(quadrantOf(point({ posts30d: 40, quietDays: 14 }))).toBe("stalled")
    expect(quadrantOf(point({ posts30d: 1, quietDays: 14 }))).toBe("dormant")
  })

  it("keeps recent sources on the left whatever their volume", () => {
    expect(quadrantOf(point({ posts30d: 40, quietDays: 1 }))).toBe("busy")
    expect(quadrantOf(point({ posts30d: 1, quietDays: 1 }))).toBe("occasional")
  })

  it("treats never-posted as the stalest thing there is", () => {
    expect(quadrantOf(point({ posts30d: 0, quietDays: null }))).toBe("dormant")
  })
})
