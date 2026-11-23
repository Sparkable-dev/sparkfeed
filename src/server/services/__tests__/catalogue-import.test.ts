import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { Database } from "@/db/client"
import type { createClient } from "@libsql/client"
import { createDb } from "@/db/client"
import { catalogueFeeds, feeds, folders } from "@/db/schema"

let database: Database
let raw: ReturnType<typeof createClient>
let testDirectory: string
vi.mock("@/db/index", () => ({
  get db() {
    return database
  },
}))
vi.mock("@/lib/demo", () => ({ DEMO_MODE: false }))
vi.mock("@/server/services/context", () => ({
  resolveWorkspaceId: () => Promise.resolve("w1"),
}))
vi.mock("@/server/services/ingest-queue", () => ({ enqueueIngest: vi.fn() }))
vi.mock("@/server/entitlements/browser-write", () => ({
  workspaceWriteMiddleware: vi.fn(),
}))
vi.mock("@/server/entitlements/enforce", () => ({
  withNoRssSourceCapacity: (
    _workspace: string,
    _count: number,
    run: (tx: Database) => Promise<unknown>
  ) => database.transaction(run),
}))
vi.mock("@tanstack/react-start", () => ({
  createServerOnlyFn: (fn: unknown) => fn,
  createServerFn: () => {
    let validate: { parse: (data: unknown) => unknown } | undefined
    const builder = {
      middleware: () => builder,
      validator: (value: typeof validate) => {
        validate = value
        return builder
      },
      handler:
        (fn: (input: { data: unknown }) => unknown) =>
        (input: { data: unknown }) =>
          fn({ data: validate ? validate.parse(input.data) : input.data }),
    }
    return builder
  },
}))
const { importCatalogueItem } = await import("@/server/catalogue")
beforeEach(async () => {
  testDirectory = mkdtempSync(join(tmpdir(), "sparkfeed-catalogue-test-"))
  database = createDb(`file:${join(testDirectory, "test.db")}`, {
    sqlite: true,
  })
  raw = (database as unknown as { $client: ReturnType<typeof createClient> })
    .$client
  await raw.execute(
    `CREATE TABLE folders (id TEXT PRIMARY KEY, name TEXT, workspace_id TEXT, parent_id TEXT, created_at TEXT, position INTEGER)`
  )
  await raw.execute(
    `CREATE TABLE feeds (id TEXT PRIMARY KEY, name TEXT, url TEXT, kind TEXT, folder_id TEXT, workspace_id TEXT, include_keywords TEXT, exclude_keywords TEXT, position INTEGER, created_at TEXT, last_fetched_at TEXT, last_error TEXT, last_error_at TEXT, http_etag TEXT, http_last_modified TEXT, entitlement_paused_at TEXT)`
  )
  await raw.execute(`CREATE TABLE catalogue_feeds (
    slug TEXT PRIMARY KEY, category TEXT, collection_slug TEXT, name TEXT, description TEXT,
    feed_url TEXT, site_url TEXT, icon_file TEXT, accent TEXT, sort_order INTEGER,
    source_kind TEXT DEFAULT 'rss', status TEXT DEFAULT 'unknown', failure_streak INTEGER,
    last_checked_at TEXT, last_error TEXT, article_count INTEGER, latest_title TEXT,
    latest_published_at TEXT, articles_fetched_at TEXT, articles_error TEXT,
    import_count INTEGER DEFAULT 0, retired_at TEXT, created_at TEXT)`)
  await database.insert(catalogueFeeds).values({
    slug: "test",
    category: "ai",
    name: "Test",
    description: "Test feed",
    feedUrl: "https://example.com/feed",
  })
  await database.insert(folders).values([
    { id: "mine", name: "Research", workspaceId: "w1" },
    { id: "other", name: "Private", workspaceId: "w2" },
  ])
})
afterEach(() => {
  raw.close()
  rmSync(testDirectory, { recursive: true, force: true })
})
it("persists a selected owned folder on the imported feed", async () => {
  const result = await importCatalogueItem({
    data: {
      kind: "feed",
      slug: "test",
      destination: { kind: "existing", folderId: "mine" },
    },
  })
  expect(result.status).toBe("ok")
  expect(
    await database.select({ folderId: feeds.folderId }).from(feeds)
  ).toEqual([{ folderId: "mine" }])
})
it("rejects a folder from another workspace without adding a feed", async () => {
  await expect(
    importCatalogueItem({
      data: {
        kind: "feed",
        slug: "test",
        destination: { kind: "existing", folderId: "other" },
      },
    })
  ).rejects.toThrow()
  expect(await database.select().from(feeds)).toHaveLength(0)
})
it("creates the folder and stores its id on the feed", async () => {
  const result = await importCatalogueItem({
    data: {
      kind: "feed",
      slug: "test",
      destination: { kind: "new", name: "New research" },
    },
  })
  expect(result.status).toBe("ok")
  const [feed] = await database.select({ folderId: feeds.folderId }).from(feeds)
  const created = (await database.select().from(folders)).find(
    (folder) => folder.id === feed.folderId
  )
  expect(created?.name).toBe("New research")
  expect(created?.workspaceId).toBe("w1")
})
it("does not create an empty folder when the source was already added", async () => {
  await importCatalogueItem({
    data: { kind: "feed", slug: "test", destination: { kind: "none" } },
  })
  const result = await importCatalogueItem({
    data: {
      kind: "feed",
      slug: "test",
      destination: { kind: "new", name: "Unused" },
    },
  })
  expect(result.status).toBe("already_added")
  expect(await database.select().from(folders)).toHaveLength(2)
})

it("rolls back the new folder if importing the feed fails", async () => {
  await raw.execute(
    `CREATE TRIGGER reject_feed BEFORE INSERT ON feeds BEGIN SELECT RAISE(ABORT, 'test insertion failure'); END`
  )
  await expect(
    importCatalogueItem({
      data: {
        kind: "feed",
        slug: "test",
        destination: { kind: "new", name: "Rolled back" },
      },
    })
  ).rejects.toThrow()
  expect(await database.select().from(folders)).toHaveLength(2)
  expect(await database.select().from(feeds)).toHaveLength(0)
})
