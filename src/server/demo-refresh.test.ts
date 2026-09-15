import { createClient } from "@libsql/client"
import { afterEach, expect, it, vi } from "vitest"
import { refreshDemoIfDue } from "./demo-refresh"
import type { Client } from "@libsql/client"

const clients: Array<Client> = []
function database() {
  const client = createClient({ url: ":memory:" })
  clients.push(client)
  return client
}
afterEach(() => {
  clients.forEach((client) => client.close())
  clients.length = 0
})
const now = 1_800_000_000_000
const hour = 60 * 60_000

it("persists the daily schedule and skips checks until the next day", async () => {
  const db = database()
  const ingest = vi.fn().mockResolvedValue({ failed: 0 })
  expect((await refreshDemoIfDue(db, ingest, now)).refreshed).toBe(true)
  const count = ingest.mock.calls.length
  expect(count).toBeGreaterThan(0)
  expect((await refreshDemoIfDue(db, ingest, now + 23 * hour)).refreshed).toBe(
    false
  )
  expect(ingest).toHaveBeenCalledTimes(count)
  expect((await refreshDemoIfDue(db, ingest, now + 24 * hour)).refreshed).toBe(
    true
  )
  expect(ingest).toHaveBeenCalledTimes(count * 2)
})

it("claims atomically so overlapping callers fetch only once", async () => {
  const db = database()
  const ingest = vi.fn().mockResolvedValue({ failed: 0 })
  const results = await Promise.all([
    refreshDemoIfDue(db, ingest, now),
    refreshDemoIfDue(db, ingest, now),
  ])
  expect(results.filter((result) => result.refreshed)).toHaveLength(1)
})

it("isolates feed failures and retries after an hour without marking success", async () => {
  const db = database()
  const ingest = vi
    .fn()
    .mockResolvedValue({ failed: 0 })
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValueOnce({ failed: 1 })
  expect(await refreshDemoIfDue(db, ingest, now)).toEqual({
    refreshed: true,
    failed: 2,
  })
  const state = await db.execute("SELECT last_success_at FROM demo_refresh")
  expect(state.rows[0].last_success_at).toBeNull()
  expect((await refreshDemoIfDue(db, ingest, now + hour - 1)).refreshed).toBe(
    false
  )
  expect(await refreshDemoIfDue(db, ingest, now + hour)).toEqual({
    refreshed: true,
    failed: 0,
  })
})

it("recovers an abandoned lease and never exceeds three concurrent feeds", async () => {
  const db = database()
  await refreshDemoIfDue(db, () => Promise.resolve({ failed: 0 }), now)
  await db.execute({
    sql: "UPDATE demo_refresh SET next_at = ?, lease_token = ?",
    args: [now + hour, "abandoned"],
  })
  let active = 0
  let peak = 0
  await refreshDemoIfDue(
    db,
    async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 2))
      active--
      return { failed: 0 }
    },
    now + hour
  )
  expect(peak).toBe(3)
  expect(
    (await db.execute("SELECT lease_token FROM demo_refresh")).rows[0]
      .lease_token
  ).toBeNull()
})
