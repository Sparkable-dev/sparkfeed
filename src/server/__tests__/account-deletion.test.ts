import { beforeEach, describe, expect, it } from "vitest"
import type { createClient } from "@libsql/client"
import type { Database } from "@/db/client"
import { createDb } from "@/db/client"
import {
  deletePersonalWorkspaceData,
  hasManagedPersonalPlusSubscription,
  ownedWorkspacesForUser,
} from "@/server/account-deletion"

let db: Database
let raw: ReturnType<typeof createClient>

beforeEach(async () => {
  db = createDb(":memory:", { sqlite: true })
  raw = (db as unknown as { $client: ReturnType<typeof createClient> }).$client

  const statements = [
    `CREATE TABLE workspace_overrides (workspace_type TEXT, workspace_id TEXT)`,
    `CREATE TABLE platform_activity_days (user_id TEXT, workspace_type TEXT, workspace_id TEXT, day TEXT, last_seen_at TEXT)`,
    `CREATE TABLE workspace_credit_schedules (workspace_type TEXT, workspace_id TEXT, user_id TEXT)`,
    `CREATE TABLE organization (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL)`,
    `CREATE TABLE member (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT)`,
    `CREATE TABLE folders (id TEXT PRIMARY KEY, name TEXT NOT NULL, workspace_id TEXT, parent_id TEXT, position INTEGER, created_at TEXT)`,
    `CREATE TABLE folder_shares (folder_id TEXT PRIMARY KEY, is_shared INTEGER NOT NULL, password TEXT, created_at TEXT)`,
    `CREATE TABLE feeds (id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, folder_id TEXT, workspace_id TEXT, kind TEXT NOT NULL, include_keywords TEXT, exclude_keywords TEXT, position INTEGER, created_at TEXT, last_fetched_at TEXT, last_error TEXT, last_error_at TEXT, entitlement_paused_at TEXT)`,
    `CREATE TABLE feed_shares (feed_id TEXT PRIMARY KEY, is_shared INTEGER NOT NULL, password TEXT, created_at TEXT)`,
    `CREATE TABLE articles (id TEXT PRIMARY KEY, feed_id TEXT, title TEXT NOT NULL, description TEXT, content TEXT, content_fetched_at TEXT, link TEXT NOT NULL, image TEXT, published_at TEXT, is_used INTEGER, visit_count INTEGER, is_bookmarked INTEGER, is_read_later INTEGER, is_favorite INTEGER, created_at TEXT)`,
    `CREATE TABLE invites (id TEXT PRIMARY KEY, email TEXT NOT NULL, workspace_id TEXT, role TEXT NOT NULL, token TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT)`,
    `CREATE TABLE api_keys (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, created_by_user_id TEXT, name TEXT NOT NULL, hash TEXT NOT NULL, prefix TEXT NOT NULL, scopes TEXT NOT NULL, last_used_at TEXT, expires_at TEXT, revoked_at TEXT, created_at TEXT)`,
    `CREATE TABLE scraped_feeds (id TEXT PRIMARY KEY, workspace_id TEXT, folder_id TEXT, site_url TEXT NOT NULL, title TEXT, last_hash TEXT, last_fetched_at TEXT, last_error TEXT, last_error_at TEXT, created_at TEXT)`,
    `CREATE TABLE scraped_articles (id TEXT PRIMARY KEY, workspace_id TEXT, folder_id TEXT, site_url TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL, date TEXT, description TEXT, created_at TEXT)`,
    `CREATE TABLE chat_threads (id TEXT PRIMARY KEY, workspace_id TEXT, user_id TEXT NOT NULL, title TEXT NOT NULL, created_at TEXT, updated_at TEXT, archived_at TEXT)`,
    `CREATE TABLE chat_messages (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, seq INTEGER NOT NULL, role TEXT NOT NULL, parts TEXT NOT NULL, search_text TEXT NOT NULL, created_at TEXT)`,
    `CREATE TABLE workspace_subscriptions (workspace_type TEXT NOT NULL, workspace_id TEXT NOT NULL, plan_key TEXT NOT NULL, billing_source TEXT NOT NULL, subscription_status TEXT NOT NULL, access_state TEXT NOT NULL, billing_interval TEXT, paid_seat_quantity INTEGER NOT NULL, scheduled_seat_quantity INTEGER, scheduled_seat_effective_at TEXT, current_period_start TEXT, current_period_end TEXT, failed_payment_grace_deadline TEXT, paid_credit_retention_ends_at TEXT, provider_event_at TEXT, dodo_customer_id TEXT, dodo_subscription_id TEXT, product_key TEXT, override_seat_limit INTEGER, override_monthly_ai_credits INTEGER, override_source_unit_limit INTEGER, override_api_access INTEGER, override_mcp_access INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (workspace_type, workspace_id))`,
    `CREATE TABLE credit_ledger (id TEXT PRIMARY KEY, workspace_type TEXT NOT NULL, workspace_id TEXT NOT NULL, beneficiary_user_id TEXT, credit_bucket TEXT NOT NULL, amount INTEGER NOT NULL, entry_type TEXT NOT NULL, grant_period TEXT, ai_request_id TEXT, reason TEXT, actor_user_id TEXT, idempotency_key TEXT NOT NULL, expires_at TEXT, created_at TEXT NOT NULL)`,
    `CREATE TABLE usage_counters (id TEXT PRIMARY KEY, workspace_type TEXT NOT NULL, workspace_id TEXT NOT NULL, beneficiary_user_id TEXT NOT NULL, metric TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL, quantity INTEGER NOT NULL, updated_at TEXT NOT NULL)`,
  ]
  for (const statement of statements) await raw.execute(statement)
})

async function count(table: string) {
  const result = await raw.execute(`SELECT COUNT(*) AS count FROM ${table}`)
  return Number(result.rows[0]?.count ?? 0)
}

describe("account deletion", () => {
  it("lists only workspaces the user owns", async () => {
    await raw.execute(
      `INSERT INTO organization VALUES ('org-b', 'Beta', 'beta')`
    )
    await raw.execute(
      `INSERT INTO organization VALUES ('org-a', 'Alpha', 'alpha')`
    )
    await raw.execute(
      `INSERT INTO member VALUES ('m-1', 'org-b', 'user-1', 'member', NULL)`
    )
    await raw.execute(
      `INSERT INTO member VALUES ('m-2', 'org-a', 'user-1', 'owner', NULL)`
    )

    await expect(ownedWorkspacesForUser(db, "user-1")).resolves.toEqual([
      { id: "org-a", name: "Alpha" },
    ])
  })

  it("blocks deletion while Dodo still manages Personal+", async () => {
    await raw.execute(
      `INSERT INTO workspace_subscriptions (workspace_type, workspace_id, plan_key, billing_source, subscription_status, access_state, paid_seat_quantity, created_at, updated_at) VALUES ('personal', 'user-1', 'personal_plus', 'dodo', 'canceled', 'active', 1, '', ''), ('personal', 'user-2', 'personal_plus', 'manual', 'active', 'active', 1, '', '')`
    )

    await expect(
      hasManagedPersonalPlusSubscription(db, "user-1")
    ).resolves.toBe(true)
    await expect(
      hasManagedPersonalPlusSubscription(db, "user-2")
    ).resolves.toBe(false)
  })

  it("deletes the personal workspace without touching team or another user's data", async () => {
    await raw.execute(
      `INSERT INTO folders VALUES ('folder-personal', 'Personal', 'user-1', NULL, NULL, NULL), ('folder-team', 'Team', 'org-1', NULL, NULL, NULL)`
    )
    await raw.execute(
      `INSERT INTO folder_shares VALUES ('folder-personal', 1, NULL, NULL), ('folder-team', 1, NULL, NULL)`
    )
    await raw.execute(
      `INSERT INTO feeds VALUES ('feed-personal', 'Personal feed', 'https://personal.test', 'folder-personal', 'user-1', 'rss', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL), ('feed-team', 'Team feed', 'https://team.test', 'folder-team', 'org-1', 'rss', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`
    )
    await raw.execute(
      `INSERT INTO feed_shares VALUES ('feed-personal', 1, NULL, NULL), ('feed-team', 1, NULL, NULL)`
    )
    await raw.execute(
      `INSERT INTO articles (id, feed_id, title, link) VALUES ('article-personal', 'feed-personal', 'Personal', 'https://personal.test/1'), ('article-team', 'feed-team', 'Team', 'https://team.test/1')`
    )
    await raw.execute(
      `INSERT INTO api_keys (id, workspace_id, name, hash, prefix, scopes) VALUES ('key-personal', 'user-1', 'Personal', 'hash-1', 'sfk_1', '[]'), ('key-team', 'org-1', 'Team', 'hash-2', 'sfk_2', '[]')`
    )
    await raw.execute(
      `INSERT INTO chat_threads (id, workspace_id, user_id, title) VALUES ('thread-personal', 'user-1', 'user-1', 'Personal'), ('thread-team-user', 'org-1', 'user-1', 'Private team chat'), ('thread-team-other', 'org-1', 'user-2', 'Other')`
    )
    await raw.execute(
      `INSERT INTO chat_messages (id, thread_id, seq, role, parts, search_text) VALUES ('message-personal', 'thread-personal', 1, 'user', '[]', ''), ('message-team-user', 'thread-team-user', 1, 'user', '[]', ''), ('message-team-other', 'thread-team-other', 1, 'user', '[]', '')`
    )
    await raw.execute(
      `INSERT INTO workspace_subscriptions (workspace_type, workspace_id, plan_key, billing_source, subscription_status, access_state, paid_seat_quantity, created_at, updated_at) VALUES ('personal', 'user-1', 'free', 'system', 'active', 'active', 1, '', ''), ('organization', 'org-1', 'pro', 'system', 'active', 'active', 1, '', '')`
    )
    await raw.execute(
      `INSERT INTO credit_ledger (id, workspace_type, workspace_id, credit_bucket, amount, entry_type, idempotency_key, created_at) VALUES ('credit-personal', 'personal', 'user-1', 'free', 50, 'grant', 'personal', ''), ('credit-team', 'organization', 'org-1', 'free', 50, 'grant', 'team', '')`
    )
    await raw.execute(
      `INSERT INTO usage_counters VALUES ('usage-personal', 'personal', 'user-1', '', 'ai', '', '', 1, ''), ('usage-team', 'organization', 'org-1', '', 'ai', '', '', 1, '')`
    )

    await deletePersonalWorkspaceData(db, "user-1")

    await expect(count("folders")).resolves.toBe(1)
    await expect(count("folder_shares")).resolves.toBe(1)
    await expect(count("feeds")).resolves.toBe(1)
    await expect(count("feed_shares")).resolves.toBe(1)
    await expect(count("articles")).resolves.toBe(1)
    await expect(count("api_keys")).resolves.toBe(1)
    await expect(count("chat_threads")).resolves.toBe(1)
    await expect(count("chat_messages")).resolves.toBe(1)
    await expect(count("workspace_subscriptions")).resolves.toBe(1)
    await expect(count("credit_ledger")).resolves.toBe(1)
    await expect(count("usage_counters")).resolves.toBe(1)
  })
})
