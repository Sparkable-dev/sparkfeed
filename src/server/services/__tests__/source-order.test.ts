import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { applySourceOrder } from "../source-order"
import { FEED_ORDER, FOLDER_ORDER } from "../ordering"
import type { createClient } from "@libsql/client"
import type { Database } from "@/db/client"
import { createDb } from "@/db/client"
import { feeds, folders } from "@/db/schema"

/**
 * The arrangement write, against a real database.
 *
 * Worth the setup for two reasons beyond the usual. This is the first
 * `db.transaction` in the codebase, so "does drizzle's libsql driver actually
 * honour it" was an open question rather than an assumption. And the ownership
 * checks here are the only thing stopping a caller parking a feed in another
 * workspace's folder — the gap `updateFeed` shipped with.
 *
 * **These run against a file, not `:memory:`, and that is not a preference.**
 * libsql runs a transaction on its own connection, and an in-memory database
 * belongs to a single connection — so inside `db.transaction` the tables simply
 * are not there, and every query after it fails with "no such table". Verified
 * both ways: identical code passes against a file and fails against `:memory:`.
 * The rest of this directory uses `:memory:` quite correctly; it just cannot be
 * used to test anything transactional.
 */

const workdir = mkdtempSync(join(tmpdir(), "sparkfeed-source-order-"))
let dbCount = 0

afterAll(() => rmSync(workdir, { recursive: true, force: true }))

const WS = "workspace-a"
const OTHER = "workspace-b"

async function freshDb(): Promise<Database> {
  const handle = createDb(`file:${join(workdir, `t${dbCount++}.db`)}`, {
    sqlite: true,
  })
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

async function seed(db: Database) {
  await db.insert(folders).values([
    { id: "f1", name: "One", workspaceId: WS, createdAt: "2026-01-01" },
    { id: "f2", name: "Two", workspaceId: WS, createdAt: "2026-01-02" },
    {
      id: "foreign",
      name: "Theirs",
      workspaceId: OTHER,
      createdAt: "2026-01-01",
    },
  ])
  await db.insert(feeds).values([
    {
      id: "a",
      name: "A",
      url: "https://a.example",
      folderId: "f1",
      workspaceId: WS,
      createdAt: "2026-01-01",
    },
    {
      id: "b",
      name: "B",
      url: "https://b.example",
      folderId: "f1",
      workspaceId: WS,
      createdAt: "2026-01-02",
    },
    {
      id: "c",
      name: "C",
      url: "https://c.example",
      folderId: null,
      workspaceId: WS,
      createdAt: "2026-01-03",
    },
  ])
}

const readFolders = (db: Database) =>
  db
    .select({ id: folders.id })
    .from(folders)
    .orderBy(...FOLDER_ORDER)

const readFeeds = (db: Database) =>
  db
    .select({
      id: feeds.id,
      folderId: feeds.folderId,
      position: feeds.position,
    })
    .from(feeds)
    .orderBy(...FEED_ORDER)

describe("applySourceOrder", () => {
  it("writes folder order, and the read path reflects it", async () => {
    const db = await freshDb()
    await seed(db)

    const result = await applySourceOrder(db, WS, {
      folders: ["f2", "f1"],
      feeds: [],
    })

    expect(result).toEqual({ status: "ok", folders: 2, feeds: 0 })
    // 'foreign' has no position and sorts last, which is also the proof that
    // another workspace's rows were left alone.
    expect((await readFolders(db)).map((f) => f.id)).toEqual([
      "f2",
      "f1",
      "foreign",
    ])
  })

  it("moves a feed between folders and reindexes both groups", async () => {
    const db = await freshDb()
    await seed(db)

    await applySourceOrder(db, WS, {
      folders: ["f1", "f2"],
      feeds: [
        { id: "b", folderId: "f1" },
        { id: "a", folderId: "f2" },
        { id: "c", folderId: null },
      ],
    })

    const rows = await readFeeds(db)
    const byId = new Map(rows.map((r) => [r.id, r]))
    expect(byId.get("a")).toMatchObject({ folderId: "f2", position: 0 })
    expect(byId.get("b")).toMatchObject({ folderId: "f1", position: 0 })
    expect(byId.get("c")).toMatchObject({ folderId: null, position: 0 })
  })

  it("writes nothing when the arrangement is unchanged", async () => {
    const db = await freshDb()
    await seed(db)

    const input = {
      folders: ["f1", "f2"],
      feeds: [
        { id: "a", folderId: "f1" },
        { id: "b", folderId: "f1" },
        { id: "c", folderId: null },
      ],
    }

    const first = await applySourceOrder(db, WS, input)
    expect(first).toEqual({ status: "ok", folders: 2, feeds: 3 })

    // Same arrangement again: the diff should find nothing left to do. This is
    // the accidental-drag case, and it must not cost writes.
    const second = await applySourceOrder(db, WS, input)
    expect(second).toEqual({ status: "ok", folders: 0, feeds: 0 })
  })

  it("refuses a feed moved into a folder the caller does not own", async () => {
    const db = await freshDb()
    await seed(db)

    const result = await applySourceOrder(db, WS, {
      folders: ["f1", "f2"],
      feeds: [{ id: "a", folderId: "foreign" }],
    })

    expect(result).toEqual({ status: "stale" })
    // And nothing was written — this is the check `updateFeed` was missing.
    const byId = new Map((await readFeeds(db)).map((r) => [r.id, r]))
    expect(byId.get("a")?.folderId).toBe("f1")
  })

  it("refuses another workspace's folder in the order list", async () => {
    const db = await freshDb()
    await seed(db)

    expect(
      await applySourceOrder(db, WS, { folders: ["f1", "foreign"], feeds: [] })
    ).toEqual({
      status: "stale",
    })
  })

  it("refuses an unknown feed id", async () => {
    const db = await freshDb()
    await seed(db)

    expect(
      await applySourceOrder(db, WS, {
        folders: [],
        feeds: [{ id: "does-not-exist", folderId: null }],
      })
    ).toEqual({ status: "stale" })
  })

  it("rolls back the whole arrangement if a write fails partway", async () => {
    const db = await freshDb()
    await seed(db)
    await applySourceOrder(db, WS, { folders: ["f1", "f2"], feeds: [] })

    /*
      Nothing else in the codebase uses `db.transaction`, so this is the test
      that establishes it actually rolls back rather than merely not throwing.
      Dropping `feeds` makes the feed writes fail *after* the folder writes have
      already run inside the transaction; if it is real, the folder order below
      is untouched. It is.
    */
    const raw = (db as unknown as { $client: ReturnType<typeof createClient> })
      .$client
    await raw.execute("DROP TABLE feeds")

    await expect(
      applySourceOrder(db, WS, {
        folders: ["f2", "f1"],
        feeds: [{ id: "a", folderId: "f1" }],
      })
    ).rejects.toThrow()

    expect((await readFolders(db)).map((f) => f.id)).toEqual([
      "f1",
      "f2",
      "foreign",
    ])
  })
})
