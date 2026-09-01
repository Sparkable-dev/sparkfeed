import { beforeEach, describe, expect, it } from "vitest"
import type { createClient } from "@libsql/client"
import type { Database } from "@/db/client"
import { createDb } from "@/db/client"
import {
  readAccountNotificationPreferences,
  saveAccountNotificationPreferences,
} from "@/server/account-notifications"

let db: Database
let raw: ReturnType<typeof createClient>

beforeEach(async () => {
  db = createDb(":memory:", { sqlite: true })
  raw = (db as unknown as { $client: ReturnType<typeof createClient> }).$client

  await raw.execute(`CREATE TABLE notification_preferences (
    user_id TEXT PRIMARY KEY,
    workspace_activity INTEGER NOT NULL DEFAULT 1,
    product_updates INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`)
})

describe("account notification preferences", () => {
  it("uses conservative defaults before a user changes anything", async () => {
    await expect(
      readAccountNotificationPreferences(db, "user-1")
    ).resolves.toEqual({ workspaceActivity: true, productUpdates: false })
  })

  it("persists both switches and updates the existing row", async () => {
    await saveAccountNotificationPreferences(db, "user-1", {
      workspaceActivity: false,
      productUpdates: true,
    })
    await saveAccountNotificationPreferences(db, "user-1", {
      workspaceActivity: true,
      productUpdates: true,
    })

    await expect(
      readAccountNotificationPreferences(db, "user-1")
    ).resolves.toEqual({ workspaceActivity: true, productUpdates: true })

    const rows = await raw.execute(
      `SELECT COUNT(*) AS count FROM notification_preferences`
    )
    expect(Number(rows.rows[0]?.count)).toBe(1)
  })
})
