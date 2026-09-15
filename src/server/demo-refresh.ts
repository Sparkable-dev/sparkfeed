import { randomUUID } from "node:crypto"
import { createClient } from "@libsql/client"
import { mapWithConcurrency } from "./utils/concurrency"
import type { Client } from "@libsql/client"
import demoConfig from "@/config/demo-feeds.json"

const DAY = 24 * 60 * 60_000
const RETRY = 60 * 60_000
const LEASE = 30 * 60_000

/** SQLite owns the schedule, so restarts and concurrent processes share it. */
export async function refreshDemoIfDue(
  client: Client,
  ingest: (id: string, url: string) => Promise<{ failed: number }>,
  now = Date.now()
) {
  await client.execute(`CREATE TABLE IF NOT EXISTS demo_refresh (
    id integer PRIMARY KEY CHECK (id = 1),
    next_at integer NOT NULL DEFAULT 0,
    last_attempt_at integer,
    last_success_at integer,
    lease_token text
  )`)
  await client.execute("INSERT OR IGNORE INTO demo_refresh (id) VALUES (1)")
  const token = randomUUID()
  const claim = await client.execute({
    sql: `UPDATE demo_refresh SET next_at = ?, last_attempt_at = ?, lease_token = ?
          WHERE id = 1 AND next_at <= ?`,
    args: [now + LEASE, now, token, now],
  })
  if (!claim.rowsAffected) return { refreshed: false, failed: 0 }

  const configured = demoConfig.folders.flatMap((folder) => folder.feeds)
  let failed = 0
  try {
    await mapWithConcurrency(configured, 3, async (feed) => {
      try {
        const result = await ingest(feed.id, feed.url)
        if (result.failed) failed++
      } catch (error) {
        failed++
        console.warn(
          `[demo-refresh] ${feed.name}:`,
          error instanceof Error ? error.message : "Fetch failed"
        )
      }
    })
  } finally {
    // Fence completion: an expired worker cannot overwrite a newer claim.
    await client.execute({
      sql: `UPDATE demo_refresh SET next_at = ?, last_success_at = CASE WHEN ? = 0 THEN ? ELSE last_success_at END,
            lease_token = NULL WHERE id = 1 AND lease_token = ?`,
      args: [now + (failed ? RETRY : DAY), failed, now, token],
    })
  }
  console.info(
    `[demo-refresh] Checked ${configured.length} feeds; ${failed} failed.`
  )
  return { refreshed: true, failed }
}

/** Called only from demo initialization and the demo server timer. */
export async function refreshDemoFeeds() {
  const client = createClient({ url: "file:rss-demo.db" })
  try {
    const { fetchAndInsertArticles } = await import("./utils/fetch-articles")
    return await refreshDemoIfDue(client, fetchAndInsertArticles)
  } finally {
    client.close()
  }
}
