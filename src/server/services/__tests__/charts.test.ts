import { beforeEach, describe, expect, it, vi } from "vitest"
import type { createClient } from "@libsql/client"
import type { Database } from "@/db/client"
import { createDb } from "@/db/client"

/**
 * The day-bucket query, against a real database.
 *
 * SQLite specifically. This is the first group-by-time in the app, and the two
 * obvious ways to write it — `date_trunc` and `strftime` — each work on exactly
 * one of the two engines this app runs on. The `substr` approach is here
 * because it works on both, and this test is what proves it on the one that
 * only the public demo uses.
 */

let db: Database

vi.mock("@/db/index", () => ({
  get db() {
    return db
  },
}))

const { articlesPerDay } = await import("../stats")

const PRINCIPAL = {
  keyId: "session",
  workspaceId: "ws-1",
  plan: "pro" as const,
  scopes: ["workspace:read" as const],
  demo: false,
}

const dayAgo = (n: number) =>
  new Date(Date.now() - n * 86_400_000).toISOString()

beforeEach(async () => {
  db = createDb(":memory:", { sqlite: true })
  const raw = (db as unknown as { $client: ReturnType<typeof createClient> })
    .$client

  await raw.execute(`CREATE TABLE feeds (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL,
    folder_id TEXT, workspace_id TEXT, kind TEXT DEFAULT 'rss', include_keywords TEXT,
    exclude_keywords TEXT, position INTEGER, created_at TEXT,
    last_fetched_at TEXT, last_error TEXT, last_error_at TEXT)`)
  await raw.execute(`CREATE TABLE articles (
    id TEXT PRIMARY KEY, feed_id TEXT, title TEXT NOT NULL, description TEXT,
    content TEXT, content_fetched_at TEXT, link TEXT NOT NULL, image TEXT,
    published_at TEXT, is_used INTEGER, visit_count INTEGER,
    is_bookmarked INTEGER, is_read_later INTEGER, is_favorite INTEGER,
    created_at TEXT)`)

  const { feeds } = await import("@/db/schema")
  await db.insert(feeds).values([
    { id: "f1", name: "Ours", url: "https://a.example/rss", workspaceId: "ws-1" },
    { id: "f2", name: "Theirs", url: "https://b.example/rss", workspaceId: "ws-2" },
  ])
})

async function seed(rows: Array<{ feedId: string; publishedAt: string | null }>) {
  const { articles } = await import("@/db/schema")
  await db.insert(articles).values(
    rows.map((row, index) => ({
      id: `a${index}`,
      feedId: row.feedId,
      title: `t${index}`,
      link: `https://a.example/${index}`,
      publishedAt: row.publishedAt,
      createdAt: row.publishedAt ?? new Date().toISOString(),
    }))
  )
}

describe("articles per day", () => {
  it("returns a bucket for every day, including the empty ones", async () => {
    /*
      The load-bearing behaviour. SQL only returns days that have rows, and a
      chart drawn straight from that closes the gaps — a week where nothing
      arrived renders as a smooth line rather than the flat spot it was.
    */
    await seed([
      { feedId: "f1", publishedAt: dayAgo(0) },
      { feedId: "f1", publishedAt: dayAgo(0) },
      { feedId: "f1", publishedAt: dayAgo(4) },
    ])

    const buckets = await articlesPerDay(PRINCIPAL, { days: 7 })

    expect(buckets).toHaveLength(7)
    expect(buckets.reduce((sum, b) => sum + b.count, 0)).toBe(3)
    // Ends on today, and every entry is a real date in order.
    expect(buckets[6]?.date).toBe(new Date().toISOString().slice(0, 10))
    expect(buckets.filter((b) => b.count === 0).length).toBe(5)
  })

  it("counts only this workspace's articles", async () => {
    await seed([
      { feedId: "f1", publishedAt: dayAgo(1) },
      { feedId: "f2", publishedAt: dayAgo(1) },
      { feedId: "f2", publishedAt: dayAgo(1) },
    ])

    const buckets = await articlesPerDay(PRINCIPAL, { days: 7 })
    expect(buckets.reduce((sum, b) => sum + b.count, 0)).toBe(1)
  })

  it("falls back to when we saw it, for an article with no publish date", async () => {
    // Plenty of feeds omit dates. Dropping those articles would under-report
    // volume for exactly the messiest sources.
    await seed([{ feedId: "f1", publishedAt: null }])

    const buckets = await articlesPerDay(PRINCIPAL, { days: 7 })
    expect(buckets.reduce((sum, b) => sum + b.count, 0)).toBe(1)
  })

  it("ignores anything older than the window", async () => {
    await seed([
      { feedId: "f1", publishedAt: dayAgo(2) },
      { feedId: "f1", publishedAt: dayAgo(40) },
    ])

    const buckets = await articlesPerDay(PRINCIPAL, { days: 7 })
    expect(buckets.reduce((sum, b) => sum + b.count, 0)).toBe(1)
  })

  it("bounds the window rather than trusting the caller", async () => {
    // The model chooses `days`, so it has to be clamped somewhere.
    expect(await articlesPerDay(PRINCIPAL, { days: 0 })).toHaveLength(1)
    expect(await articlesPerDay(PRINCIPAL, { days: 10_000 })).toHaveLength(365)
  })
})
