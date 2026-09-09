import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Database } from "@/db/client"
import type { createClient } from "@libsql/client"
import { createDb } from "@/db/client"
import { feeds } from "@/db/schema"

let database: Database
let raw: ReturnType<typeof createClient>
const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  ingest: vi.fn(),
  writable: vi.fn(),
}))
vi.mock("@/db/index", () => ({
  get db() {
    return database
  },
}))
vi.mock("@/server/services/context", () => ({
  resolveWorkspaceContext: mocks.context,
  resolveWorkspaceId: async () => (await mocks.context()).workspaceId,
}))
vi.mock("@/server/services/ingest-queue", () => ({
  ingestFeeds: mocks.ingest,
  enqueueIngest: vi.fn(),
}))
vi.mock("@/server/entitlements/browser-write", () => ({
  workspaceWriteMiddleware: mocks.writable,
}))
vi.mock("@tanstack/react-start", () => ({
  createServerOnlyFn: (fn: unknown) => fn,
  createServerFn: () => {
    let validate: any
    let middleware: Array<() => Promise<void>> = []
    const builder = {
      middleware: (value: typeof middleware) => {
        middleware = value
        return builder
      },
      validator: (value: any) => {
        validate = value
        return builder
      },
      handler: (fn: any) => async (input?: any) => {
        for (const run of middleware) await run()
        const data = validate
          ? typeof validate === "function"
            ? validate(input?.data)
            : validate.parse(input?.data)
          : input?.data
        return fn({ data })
      },
    }
    return builder
  },
}))

const { refreshStaleFeeds, refreshAllFeeds } = await import("@/server/rss")
beforeEach(async () => {
  vi.clearAllMocks()
  database = createDb(":memory:", { sqlite: true })
  raw = (database as unknown as { $client: ReturnType<typeof createClient> })
    .$client
  await raw.execute(`CREATE TABLE feeds (http_etag TEXT, http_last_modified TEXT,
    id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, folder_id TEXT,
    workspace_id TEXT, kind TEXT DEFAULT 'rss', include_keywords TEXT, exclude_keywords TEXT,
    position INTEGER, created_at TEXT, last_fetched_at TEXT, last_error TEXT,
    last_error_at TEXT, entitlement_paused_at TEXT)`)
  mocks.context.mockResolvedValue({ workspaceId: "w1", demo: false })
  mocks.writable.mockResolvedValue(undefined)
  mocks.ingest.mockResolvedValue({ inserted: 1, failed: 0, refreshed: 1 })
  const now = new Date().toISOString()
  for (const row of [
    { id: "stale", workspaceId: "w1", lastFetchedAt: "2026-01-01T00:00:00Z" },
    { id: "never", workspaceId: "w1", kind: "page" },
    { id: "fresh", workspaceId: "w1", lastFetchedAt: now },
    { id: "failed-recently", workspaceId: "w1", lastErrorAt: now },
    { id: "paused", workspaceId: "w1", entitlementPausedAt: now },
    { id: "other", workspaceId: "w2" },
  ])
    await database
      .insert(feeds)
      .values({ name: row.id, url: "https://example.test/feed", ...row })
})
afterEach(() => raw.close())

describe("refresh server functions", () => {
  it("rechecks database freshness and scopes to active workspace sources", async () => {
    await refreshStaleFeeds({ data: { workspaceId: "w1" } })
    expect(mocks.writable).toHaveBeenCalledOnce()
    expect(
      mocks.ingest.mock.calls[0][0].map((item: any) => item.feedId).sort()
    ).toEqual(["never", "stale"])
    expect(
      mocks.ingest.mock.calls[0][0].find((item: any) => item.feedId === "never")
        .kind
    ).toBe("page")
  })
  it("does nothing after a workspace switch or in demo mode", async () => {
    await refreshStaleFeeds({ data: { workspaceId: "w2" } })
    mocks.context.mockResolvedValue({ workspaceId: "w1", demo: true })
    await refreshStaleFeeds({ data: { workspaceId: "w1" } })
    expect(mocks.ingest).not.toHaveBeenCalled()
  })
  it("preserves the write guard for read-only or suspended workspaces", async () => {
    mocks.writable.mockRejectedValueOnce(new Error("read-only"))
    await expect(
      refreshStaleFeeds({ data: { workspaceId: "w1" } })
    ).rejects.toThrow("read-only")
    expect(mocks.ingest).not.toHaveBeenCalled()
  })
  it("allows explicit refresh of fresh sources without including paused or foreign sources", async () => {
    await refreshAllFeeds()
    expect(
      mocks.ingest.mock.calls[0][0].map((item: any) => item.feedId).sort()
    ).toEqual(["failed-recently", "fresh", "never", "stale"])
  })
})
