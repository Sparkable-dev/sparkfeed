import { beforeEach, describe, expect, it, vi } from "vitest"
import type { createClient } from "@libsql/client"
import type { Database } from "@/db/client"
import { createDb } from "@/db/client"

let db: Database

vi.mock("@/db/index", () => ({
  get db() {
    return db
  },
}))

const {
  refreshPersonalSubscriptionLifecycle,
  repairFailedInitialPersonalCheckout,
  selectFreePersonalSources,
} = await import("../personal-lifecycle")

beforeEach(async () => {
  db = createDb(":memory:", { sqlite: true })
  const raw = (db as unknown as { $client: ReturnType<typeof createClient> })
    .$client
  await raw.execute(`CREATE TABLE feeds (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL,
    folder_id TEXT, workspace_id TEXT, kind TEXT DEFAULT 'rss',
    include_keywords TEXT, exclude_keywords TEXT, position INTEGER,
    created_at TEXT, last_fetched_at TEXT, last_error TEXT,
    last_error_at TEXT, entitlement_paused_at TEXT)`)
  await raw.execute(`CREATE TABLE workspace_subscriptions (
    workspace_type TEXT NOT NULL, workspace_id TEXT NOT NULL,
    plan_key TEXT NOT NULL, billing_source TEXT NOT NULL,
    subscription_status TEXT NOT NULL, access_state TEXT NOT NULL,
    billing_interval TEXT, paid_seat_quantity INTEGER NOT NULL DEFAULT 1,
    scheduled_seat_quantity INTEGER, scheduled_seat_effective_at TEXT,
    current_period_start TEXT, current_period_end TEXT,
    failed_payment_grace_deadline TEXT, paid_credit_retention_ends_at TEXT,
    provider_event_at TEXT, dodo_customer_id TEXT, dodo_subscription_id TEXT,
    product_key TEXT, override_seat_limit INTEGER,
    override_monthly_ai_credits INTEGER, override_source_unit_limit INTEGER,
    override_api_access INTEGER, override_mcp_access INTEGER,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace_type, workspace_id))`)
  await raw.execute(`CREATE TABLE credit_ledger (
    id TEXT PRIMARY KEY, workspace_type TEXT NOT NULL, workspace_id TEXT NOT NULL,
    beneficiary_user_id TEXT, credit_bucket TEXT NOT NULL, amount INTEGER NOT NULL,
    entry_type TEXT NOT NULL, grant_period TEXT, ai_request_id TEXT, reason TEXT,
    actor_user_id TEXT, idempotency_key TEXT NOT NULL UNIQUE,
    expires_at TEXT, created_at TEXT NOT NULL)`)

  const { feeds, workspaceSubscriptions } = await import("@/db/schema")
  await db.insert(feeds).values(
    Array.from({ length: 7 }, (_, index) => ({
      id: `page-${index}`,
      name: `Page ${index}`,
      url: `https://example.com/${index}`,
      workspaceId: "user-1",
      kind: "page",
      createdAt: `2026-08-${String(index + 1).padStart(2, "0")}`,
    }))
  )
  await db.insert(workspaceSubscriptions).values({
    workspaceType: "personal",
    workspaceId: "user-1",
    planKey: "personal_plus",
    billingSource: "dodo",
    subscriptionStatus: "canceled",
    accessState: "active",
    billingInterval: "monthly",
    paidSeatQuantity: 1,
    currentPeriodEnd: "2026-08-01T00:00:00.000Z",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  })
})

describe("Personal+ downgrade", () => {
  it("returns to Free and pauses every no-RSS source beyond five", async () => {
    await refreshPersonalSubscriptionLifecycle(
      "user-1",
      new Date("2026-08-02T00:00:00.000Z")
    )

    const raw = (db as unknown as { $client: ReturnType<typeof createClient> })
      .$client
    const subscription = await raw.execute(
      "SELECT plan_key, subscription_status, paid_credit_retention_ends_at FROM workspace_subscriptions"
    )
    expect(subscription.rows[0]).toMatchObject({
      plan_key: "free",
      subscription_status: "free",
      paid_credit_retention_ends_at: "2026-09-01T00:00:00.000Z",
    })

    const sources = await raw.execute(
      "SELECT id, entitlement_paused_at FROM feeds ORDER BY id"
    )
    expect(
      sources.rows.filter((source) => source.entitlement_paused_at === null)
    ).toHaveLength(5)
    expect(
      sources.rows.filter((source) => source.entitlement_paused_at !== null)
    ).toHaveLength(2)
  })

  it("lets the owner choose a different set of five active sources", async () => {
    await selectFreePersonalSources("user-1", [
      "page-2",
      "page-3",
      "page-4",
      "page-5",
      "page-6",
    ])

    const raw = (db as unknown as { $client: ReturnType<typeof createClient> })
      .$client
    const active = await raw.execute(
      "SELECT id FROM feeds WHERE entitlement_paused_at IS NULL ORDER BY id"
    )
    expect(active.rows).toEqual([
      { id: "page-2" },
      { id: "page-3" },
      { id: "page-4" },
      { id: "page-5" },
      { id: "page-6" },
    ])
  })

  it("repairs a past-due record that never completed its first payment", async () => {
    const { and, eq } = await import("drizzle-orm")
    const { workspaceSubscriptions } = await import("@/db/schema")
    await db
      .update(workspaceSubscriptions)
      .set({
        subscriptionStatus: "past_due",
        currentPeriodStart: "2026-08-30T12:49:54.769Z",
        currentPeriodEnd: "2026-08-30T12:49:54.769Z",
        dodoSubscriptionId: "sub-failed",
        productKey: "personal-monthly",
      })
      .where(
        and(
          eq(workspaceSubscriptions.workspaceType, "personal"),
          eq(workspaceSubscriptions.workspaceId, "user-1")
        )
      )

    await expect(repairFailedInitialPersonalCheckout("user-1")).resolves.toBe(
      true
    )

    const raw = (db as unknown as { $client: ReturnType<typeof createClient> })
      .$client
    const subscription = await raw.execute(
      "SELECT plan_key, billing_source, subscription_status, dodo_subscription_id, product_key FROM workspace_subscriptions"
    )
    expect(subscription.rows).toEqual([
      {
        plan_key: "free",
        billing_source: "free",
        subscription_status: "free",
        dodo_subscription_id: null,
        product_key: null,
      },
    ])
  })
})
