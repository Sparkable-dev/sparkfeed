import { describe, expect, it } from "vitest"
import { FEED_ORDER, FOLDER_ORDER } from "../ordering"
import type { createClient } from "@libsql/client"
import type { Database } from "@/db/client"
import { createDb } from "@/db/client"
import { feeds, folders } from "@/db/schema"

/**
 * The one assertion that makes `ordering.ts` worth having.
 *
 * Postgres sorts nulls last on `ASC`; SQLite sorts them first. Demo mode runs
 * the Postgres table objects against SQLite, so a bare `ORDER BY position`
 * would put never-dragged rows at the top there and at the bottom in
 * production, and the difference is invisible until someone compares two
 * deployments. This runs against the same libsql-in-memory arrangement demo
 * uses, so if the keyword ever stops working the suite says so.
 */

async function freshDb(): Promise<Database> {
  const handle = createDb(":memory:", { sqlite: true })
  const raw = (
    handle as unknown as { $client: ReturnType<typeof createClient> }
  ).$client

  await raw.execute(`CREATE TABLE folders (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    workspace_id TEXT, parent_id TEXT, position INTEGER, created_at TEXT)`)
  await raw.execute(`CREATE TABLE feeds (http_etag TEXT, http_last_modified TEXT,
    id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL,
    folder_id TEXT, workspace_id TEXT, kind TEXT DEFAULT 'rss',
    include_keywords TEXT, exclude_keywords TEXT, position INTEGER,
    created_at TEXT, last_fetched_at TEXT, last_error TEXT, last_error_at TEXT,
    entitlement_paused_at TEXT)`)

  return handle
}

describe("ordering", () => {
  it("sorts positioned folders first and unpositioned ones by creation", async () => {
    const db = await freshDb()
    // Deliberately inserted out of both orders, so a passing result cannot be
    // insertion order in disguise.
    await db.insert(folders).values([
      {
        id: "never-dragged-new",
        name: "d",
        position: null,
        createdAt: "2026-02-01",
      },
      { id: "second", name: "b", position: 1, createdAt: "2026-01-02" },
      {
        id: "never-dragged-old",
        name: "c",
        position: null,
        createdAt: "2026-01-01",
      },
      { id: "first", name: "a", position: 0, createdAt: "2026-03-01" },
    ])

    const rows = await db
      .select({ id: folders.id })
      .from(folders)
      .orderBy(...FOLDER_ORDER)

    expect(rows.map((r) => r.id)).toEqual([
      "first",
      "second",
      "never-dragged-old",
      "never-dragged-new",
    ])
  })

  it("orders feeds the same way", async () => {
    const db = await freshDb()
    await db.insert(feeds).values([
      {
        id: "untouched",
        name: "u",
        url: "https://u.example",
        position: null,
        createdAt: "2026-01-05",
      },
      {
        id: "dragged",
        name: "d",
        url: "https://d.example",
        position: 0,
        createdAt: "2026-09-09",
      },
    ])

    const rows = await db
      .select({ id: feeds.id })
      .from(feeds)
      .orderBy(...FEED_ORDER)

    expect(rows.map((r) => r.id)).toEqual(["dragged", "untouched"])
  })

  it("leaves an all-null table in creation order, which is what shipped before", async () => {
    const db = await freshDb()
    await db.insert(folders).values([
      { id: "c", name: "c", createdAt: "2026-03-01" },
      { id: "a", name: "a", createdAt: "2026-01-01" },
      { id: "b", name: "b", createdAt: "2026-02-01" },
    ])

    const rows = await db
      .select({ id: folders.id })
      .from(folders)
      .orderBy(...FOLDER_ORDER)

    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"])
  })
})
