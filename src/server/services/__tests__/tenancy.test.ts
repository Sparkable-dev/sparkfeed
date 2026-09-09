import { describe, expect, it } from "vitest"
import { and, eq } from "drizzle-orm"
import {
  articleInWorkspace,
  feedInWorkspace,
  folderInWorkspace,
} from "../tenancy"
import type { createClient } from "@libsql/client"
import type { Database } from "@/db/client"
import { createDb } from "@/db/client"
import { articles, feeds, folders } from "@/db/schema"

/**
 * These predicates are the only thing standing between an API key and every
 * other workspace's data, so they run against a real database rather than
 * asserting on a generated SQL string. A predicate that compiles and reads
 * correctly can still match the wrong rows.
 *
 * SQLite in memory, driven through the PG table definitions: the same
 * arrangement demo mode runs in production.
 */

const WS_A = "workspace-a"
const WS_B = "workspace-b"

/**
 * A `:memory:` database lives and dies with its connection, so schema, fixture
 * and assertions all have to go through one handle. Hence per-test setup rather
 * than a shared beforeEach.
 */
async function freshDb(): Promise<Database> {
  const handle = createDb(":memory:", { sqlite: true })
  const raw = (
    handle as unknown as { $client: ReturnType<typeof createClient> }
  ).$client

  // Only the columns these predicates touch.
  await raw.execute(`CREATE TABLE folders (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    workspace_id TEXT, parent_id TEXT, position INTEGER, created_at TEXT)`)
  // Drizzle emits every column in the TS schema on an insert, so this fixture
  // has to track schema.pg.ts even for columns these predicates never read.
  await raw.execute(`CREATE TABLE feeds (http_etag TEXT, http_last_modified TEXT,
    id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL,
    folder_id TEXT, workspace_id TEXT, kind TEXT DEFAULT 'rss',
    include_keywords TEXT, exclude_keywords TEXT, position INTEGER, created_at TEXT,
    last_fetched_at TEXT, last_error TEXT, last_error_at TEXT,
    entitlement_paused_at TEXT)`)
  await raw.execute(`CREATE TABLE articles (source_id TEXT, source_updated_at TEXT, content_source TEXT, content_error_at TEXT,
    id TEXT PRIMARY KEY, feed_id TEXT, title TEXT NOT NULL,
    description TEXT, content TEXT, content_fetched_at TEXT,
    link TEXT NOT NULL, image TEXT, published_at TEXT,
    is_used INTEGER DEFAULT 0, visit_count INTEGER DEFAULT 0,
    is_bookmarked INTEGER DEFAULT 0, is_read_later INTEGER DEFAULT 0,
    is_favorite INTEGER DEFAULT 0, created_at TEXT)`)

  await handle.insert(folders).values([
    { id: "fol-a", name: "A folder", workspaceId: WS_A },
    { id: "fol-b", name: "B folder", workspaceId: WS_B },
    { id: "fol-legacy", name: "Legacy", workspaceId: null },
  ])
  await handle.insert(feeds).values([
    {
      id: "feed-a",
      name: "A feed",
      url: "https://a.example/rss",
      workspaceId: WS_A,
    },
    {
      id: "feed-b",
      name: "B feed",
      url: "https://b.example/rss",
      workspaceId: WS_B,
    },
    {
      id: "feed-legacy",
      name: "Legacy feed",
      url: "https://l.example/rss",
      workspaceId: null,
    },
  ])
  await handle.insert(articles).values([
    {
      id: "art-a",
      feedId: "feed-a",
      title: "A article",
      link: "https://a.example/1",
    },
    {
      id: "art-b",
      feedId: "feed-b",
      title: "B article",
      link: "https://b.example/1",
    },
    {
      id: "art-legacy",
      feedId: "feed-legacy",
      title: "Legacy",
      link: "https://l.example/1",
    },
    // Orphan: no feed row, so it belongs to no workspace and must never match.
    {
      id: "art-orphan",
      feedId: "feed-gone",
      title: "Orphan",
      link: "https://x.example/1",
    },
  ])
  return handle
}

describe("workspace predicates", () => {
  it("folderInWorkspace matches only that workspace", async () => {
    const db = await freshDb()
    const rows = await db
      .select({ id: folders.id })
      .from(folders)
      .where(folderInWorkspace(WS_A))
    expect(rows.map((r) => r.id)).toEqual(["fol-a"])
  })

  it("feedInWorkspace matches only that workspace", async () => {
    const db = await freshDb()
    const rows = await db
      .select({ id: feeds.id })
      .from(feeds)
      .where(feedInWorkspace(WS_B))
    expect(rows.map((r) => r.id)).toEqual(["feed-b"])
  })

  it("a null workspace scopes to legacy rows, it does not disable the filter", async () => {
    // The failure mode being guarded against: treating "no workspace" as "no
    // WHERE clause", which would hand an unauthenticated caller everything.
    const db = await freshDb()
    const rows = await db
      .select({ id: feeds.id })
      .from(feeds)
      .where(feedInWorkspace(null))
    expect(rows.map((r) => r.id)).toEqual(["feed-legacy"])
  })

  it("articleInWorkspace reaches ownership through the feed join", async () => {
    const db = await freshDb()
    const rows = await db
      .select({ id: articles.id })
      .from(articles)
      .where(articleInWorkspace(WS_A))
    expect(rows.map((r) => r.id)).toEqual(["art-a"])
  })

  it("articleInWorkspace excludes articles whose feed row is missing", async () => {
    const db = await freshDb()
    const rows = await db
      .select({ id: articles.id })
      .from(articles)
      .where(articleInWorkspace(WS_A))
    expect(rows.map((r) => r.id)).not.toContain("art-orphan")
  })

  // The regression this file exists for: before scoping, these handlers took an
  // article id and updated it with no workspace filter at all.
  it("a scoped UPDATE cannot touch another workspace article by id", async () => {
    const db = await freshDb()

    await db
      .update(articles)
      .set({ isFavorite: true })
      .where(and(eq(articles.id, "art-b"), articleInWorkspace(WS_A)))

    const [victim] = await db
      .select({ isFavorite: articles.isFavorite })
      .from(articles)
      .where(eq(articles.id, "art-b"))

    expect(victim.isFavorite).toBeFalsy()
  })

  it("a scoped UPDATE still works on your own article", async () => {
    const db = await freshDb()

    await db
      .update(articles)
      .set({ isFavorite: true })
      .where(and(eq(articles.id, "art-a"), articleInWorkspace(WS_A)))

    const [own] = await db
      .select({ isFavorite: articles.isFavorite })
      .from(articles)
      .where(eq(articles.id, "art-a"))

    expect(own.isFavorite).toBeTruthy()
  })
})
