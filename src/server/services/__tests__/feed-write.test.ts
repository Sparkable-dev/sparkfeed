import { beforeEach, describe, expect, it, vi } from "vitest"
import type { createClient } from "@libsql/client"
import type { Database } from "@/db/client"
import { createDb } from "@/db/client"

/**
 * The one place rows get written for a new subscription.
 *
 * Worth isolating because every bug here is silent and permanent: a duplicate
 * that slips through becomes two identical feeds in a sidebar, and a folder
 * name that is not uniquified becomes two folders with the same label that only
 * their ids tell apart.
 *
 * The ingest queue is mocked out — it is a fire-and-forget network job, and
 * what is being tested is which rows exist afterwards.
 */

let db: Database
const queued: Array<{ feedId: string; url: string; kind?: string | null }> = []

vi.mock("@/db/index", () => ({
  get db() {
    return db
  },
}))

vi.mock("../ingest-queue", () => ({
  enqueueIngest: (
    tasks: Array<{ feedId: string; url: string; kind?: string | null }>
  ) => {
    queued.push(...tasks)
  },
}))

const {
  cleanFolderName,
  existingFeedKeys,
  freeFolderName,
  insertFeedRows,
  requeueUnfetched,
  resolveDestination,
} = await import("../feed-write")

const WS = "ws-1"

beforeEach(async () => {
  queued.length = 0
  db = createDb(":memory:", { sqlite: true })
  const raw = (db as unknown as { $client: ReturnType<typeof createClient> })
    .$client
  await raw.execute(`CREATE TABLE feeds (http_etag TEXT, http_last_modified TEXT,
    id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL,
    folder_id TEXT, workspace_id TEXT, kind TEXT DEFAULT 'rss', include_keywords TEXT,
    exclude_keywords TEXT, position INTEGER, created_at TEXT,
    last_fetched_at TEXT, last_error TEXT, last_error_at TEXT,
    entitlement_paused_at TEXT)`)
  await raw.execute(`CREATE TABLE folders (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, workspace_id TEXT,
    parent_id TEXT, position INTEGER, created_at TEXT)`)
})

async function seedFeed(over: {
  url: string
  workspaceId?: string | null
  id?: string
}) {
  const { feeds } = await import("@/db/schema")
  await db.insert(feeds).values({
    id: over.id ?? `f-${over.url}`,
    name: "Seeded",
    url: over.url,
    workspaceId: over.workspaceId === undefined ? WS : over.workspaceId,
  })
}

async function seedFolder(
  id: string,
  name: string,
  workspaceId: string | null = WS
) {
  const { folders } = await import("@/db/schema")
  await db.insert(folders).values({ id, name, workspaceId })
}

describe("existingFeedKeys", () => {
  it("catches a duplicate that differs only by scheme or trailing slash", async () => {
    // The bug this replaces: "already subscribed" was decided with a normalised
    // comparison while the insert matched exactly, so the app could report a
    // feed as present and then add it a second time.
    await seedFeed({ url: "http://example.com/feed/" })
    const keys = await existingFeedKeys(WS)

    const { feedUrlKey } = await import("@/lib/validation")
    expect(keys.has(feedUrlKey("https://example.com/feed"))).toBe(true)
  })

  it("does not see another workspace's subscriptions", async () => {
    await seedFeed({ url: "https://example.com/feed", workspaceId: "ws-other" })
    expect((await existingFeedKeys(WS)).size).toBe(0)
  })
})

describe("cleanFolderName", () => {
  it("trims, collapses runs of whitespace and caps the length", () => {
    expect(cleanFolderName("  AI   Research  ")).toBe("AI Research")
    expect(cleanFolderName("x".repeat(200))).toHaveLength(60)
  })

  it("rejects a name that is nothing but whitespace", () => {
    // A folder named " " is invisible in the sidebar and impossible to click.
    expect(cleanFolderName("   ")).toBeNull()
    expect(cleanFolderName("")).toBeNull()
  })
})

describe("freeFolderName", () => {
  it("returns the name unchanged when it is free", async () => {
    expect(await freeFolderName(WS, "News")).toBe("News")
  })

  it("suffixes rather than colliding", async () => {
    await seedFolder("a", "News")
    expect(await freeFolderName(WS, "News")).toBe("News (2)")
    await seedFolder("b", "News (2)")
    expect(await freeFolderName(WS, "News")).toBe("News (3)")
  })

  it("ignores folders belonging to another workspace", async () => {
    await seedFolder("a", "News", "ws-other")
    expect(await freeFolderName(WS, "News")).toBe("News")
  })
})

describe("resolveDestination", () => {
  it("returns nothing for the unfiled destination", async () => {
    expect(await resolveDestination(WS, { kind: "none" })).toBeNull()
  })

  it("passes an owned folder straight through", async () => {
    await seedFolder("f1", "News")
    expect(
      await resolveDestination(WS, { kind: "existing", folderId: "f1" })
    ).toBe("f1")
  })

  it("refuses a folder belonging to someone else", async () => {
    // Checked before any outbound work, so an unowned destination cannot make
    // the server go and resolve URLs on another workspace's behalf.
    await seedFolder("f1", "News", "ws-other")
    await expect(
      resolveDestination(WS, { kind: "existing", folderId: "f1" })
    ).rejects.toThrow(/not found/i)
  })

  it("creates a new folder, cleaned and uniquified", async () => {
    await seedFolder("f1", "News")
    const id = await resolveDestination(WS, { kind: "new", name: "   News   " })

    const { folders } = await import("@/db/schema")
    const rows = await db.select().from(folders)
    expect(rows.find((f) => f.id === id)?.name).toBe("News (2)")
  })

  it("files under nothing rather than creating a blank folder", async () => {
    expect(
      await resolveDestination(WS, { kind: "new", name: "   " })
    ).toBeNull()
  })
})

describe("insertFeedRows", () => {
  it("writes every row in one go and hands them to the queue", async () => {
    // The point of the rework: no inline fetching, so twenty feeds cost one
    // insert rather than twenty serial HTTP round trips.
    const added = await insertFeedRows(WS, "f1", [
      { url: "https://a.example/feed", name: "A" },
      { url: "https://b.example/feed", name: "B" },
    ])

    expect(added.map((f) => f.name)).toEqual(["A", "B"])
    expect(queued.map((t) => t.url)).toEqual([
      "https://a.example/feed",
      "https://b.example/feed",
    ])

    const { feeds } = await import("@/db/schema")
    const rows = await db.select().from(feeds)
    expect(rows).toHaveLength(2)
    expect(rows[0].folderId).toBe("f1")
    expect(rows[0].workspaceId).toBe(WS)
  })

  it("does nothing at all for an empty list", async () => {
    expect(await insertFeedRows(WS, null, [])).toEqual([])
    expect(queued).toHaveLength(0)
  })

  it("stores keyword filters as JSON, defaulting to empty", async () => {
    await insertFeedRows(WS, null, [
      { url: "https://a.example/feed", name: "A", includeKeywords: ["ai"] },
    ])
    const { feeds } = await import("@/db/schema")
    const [row] = await db.select().from(feeds)
    expect(row.includeKeywords).toBe('["ai"]')
    expect(row.excludeKeywords).toBe("[]")
  })
})

describe("requeueUnfetched", () => {
  it("picks up a feed that was inserted but never attempted", async () => {
    // The deploy-restart gap: the ingest queue is an unawaited promise, so a
    // restart loses in-flight work. A feed with neither a fetch nor an error
    // stamped on it has never been tried, which nothing else produces.
    await seedFeed({ url: "https://a.example/feed", id: "f1" })
    expect(await requeueUnfetched(WS)).toBe(1)
    // The kind rides along so the queue knows whether to parse a feed or read
    // a page.
    expect(queued).toEqual([
      { feedId: "f1", url: "https://a.example/feed", kind: "rss" },
    ])
  })

  it("leaves alone a feed that has already been tried, successfully or not", async () => {
    const { feeds } = await import("@/db/schema")
    await db.insert(feeds).values([
      {
        id: "ok",
        name: "OK",
        url: "https://a.example/feed",
        workspaceId: WS,
        lastFetchedAt: new Date().toISOString(),
      },
      {
        id: "broken",
        name: "Broken",
        url: "https://b.example/feed",
        workspaceId: WS,
        lastError: "404",
        lastErrorAt: new Date().toISOString(),
      },
    ])

    expect(await requeueUnfetched(WS)).toBe(0)
    expect(queued).toHaveLength(0)
  })

  it("stays inside the workspace", async () => {
    await seedFeed({ url: "https://a.example/feed", workspaceId: "ws-other" })
    expect(await requeueUnfetched(WS)).toBe(0)
  })
})
