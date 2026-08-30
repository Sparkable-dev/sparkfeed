import { beforeEach, describe, expect, it, vi } from "vitest"
import type { createClient } from "@libsql/client"
import type { UnwrapWebhookEvent } from "dodopayments/resources/webhooks/webhooks"
import type { Database } from "@/db/client"
import { createDb } from "@/db/client"

let db: Database
const grant = vi.fn().mockResolvedValue(100)
const reactivate = vi.fn().mockResolvedValue(undefined)

vi.mock("@/db/index", () => ({
  get db() {
    return db
  },
}))
vi.mock("../personal-credits", () => ({
  grantPersonalMonthlyCredits: grant,
}))
vi.mock("../personal-lifecycle", () => ({
  downgradePersonalWorkspace: vi.fn(),
  reactivatePersonalPlusSources: reactivate,
}))

const { ingestVerifiedDodoWebhook } = await import("../personal-webhooks")

const config = {
  apiKey: "test-key",
  webhookSecret: "test-secret",
  environment: "test_mode" as const,
  appUrl: "https://app.sparkfeed.dev",
  personalProducts: {
    monthly: "product-monthly",
    annual: "product-annual",
  },
}

function activeEvent(customerId = "cus-1"): UnwrapWebhookEvent {
  return {
    type: "subscription.active",
    timestamp: "2026-08-30T10:00:00.000Z",
    business_id: "business-1",
    data: {
      subscription_id: "sub-1",
      product_id: "product-monthly",
      status: "active",
      customer: { customer_id: customerId },
      metadata: {
        billingSubjectType: "personal",
        billingSubjectId: "user-1",
      },
      previous_billing_date: "2026-08-30T10:00:00.000Z",
      next_billing_date: "2026-09-30T10:00:00.000Z",
    },
  } as unknown as UnwrapWebhookEvent
}

beforeEach(async () => {
  grant.mockClear()
  reactivate.mockClear()
  db = createDb(":memory:", { sqlite: true })
  const raw = (db as unknown as { $client: ReturnType<typeof createClient> })
    .$client
  await raw.execute(`CREATE TABLE user (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL,
    email_verified INTEGER NOT NULL, image TEXT, dodo_customer_id TEXT,
    role TEXT NOT NULL DEFAULT 'user', banned INTEGER NOT NULL DEFAULT 0,
    ban_reason TEXT, ban_expires TEXT, two_factor_enabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
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
  await raw.execute(`CREATE TABLE dodo_webhook_inbox (
    webhook_id TEXT PRIMARY KEY, event_type TEXT NOT NULL,
    event_time TEXT NOT NULL, payload_hash TEXT NOT NULL,
    subject_type TEXT, subject_id TEXT, dodo_subscription_id TEXT,
    processing_status TEXT NOT NULL DEFAULT 'pending',
    attempt_count INTEGER NOT NULL DEFAULT 0, last_error TEXT,
    received_at TEXT NOT NULL, processing_started_at TEXT, processed_at TEXT)`)

  const { user, workspaceSubscriptions } = await import("@/db/schema")
  const now = new Date("2026-08-30T09:00:00.000Z")
  await db.insert(user).values({
    id: "user-1",
    name: "Sudu",
    email: "sudu@example.com",
    emailVerified: true,
    dodoCustomerId: "cus-1",
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(workspaceSubscriptions).values({
    workspaceType: "personal",
    workspaceId: "user-1",
    planKey: "free",
    billingSource: "dodo",
    subscriptionStatus: "checkout_pending",
    accessState: "active",
    billingInterval: "monthly",
    paidSeatQuantity: 1,
    dodoCustomerId: "cus-1",
    productKey: "personal-monthly",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  })
})

describe("Personal+ Dodo webhooks", () => {
  it("activates local access once and grants the monthly allowance", async () => {
    const rawBody = JSON.stringify(activeEvent())
    const first = await ingestVerifiedDodoWebhook({
      webhookId: "webhook-1",
      rawBody,
      event: activeEvent(),
      config,
    })
    const duplicate = await ingestVerifiedDodoWebhook({
      webhookId: "webhook-1",
      rawBody,
      event: activeEvent(),
      config,
    })

    expect(first).toEqual({ duplicate: false })
    expect(duplicate).toEqual({ duplicate: true })
    expect(grant).toHaveBeenCalledTimes(1)
    expect(grant).toHaveBeenCalledWith("user-1", "2026-08-30T10:00:00.000Z")
    expect(reactivate).toHaveBeenCalledTimes(1)

    const raw = (db as unknown as { $client: ReturnType<typeof createClient> })
      .$client
    const subscription = await raw.execute(
      "SELECT plan_key, subscription_status, dodo_subscription_id FROM workspace_subscriptions"
    )
    expect(subscription.rows).toEqual([
      {
        plan_key: "personal_plus",
        subscription_status: "active",
        dodo_subscription_id: "sub-1",
      },
    ])
  })

  it("rejects a customer that does not match the personal account", async () => {
    const event = activeEvent("cus-other")
    await expect(
      ingestVerifiedDodoWebhook({
        webhookId: "webhook-2",
        rawBody: JSON.stringify(event),
        event,
        config,
      })
    ).rejects.toThrow("does not match")

    const raw = (db as unknown as { $client: ReturnType<typeof createClient> })
      .$client
    const inbox = await raw.execute(
      "SELECT processing_status FROM dodo_webhook_inbox WHERE webhook_id = 'webhook-2'"
    )
    expect(inbox.rows).toEqual([{ processing_status: "failed" }])
  })

  it("keeps a declined first checkout on Free and allows a clean retry", async () => {
    const event = {
      ...activeEvent(),
      type: "subscription.failed",
      data: {
        ...activeEvent().data,
        status: "failed",
      },
    } as UnwrapWebhookEvent

    await ingestVerifiedDodoWebhook({
      webhookId: "webhook-initial-failure",
      rawBody: JSON.stringify(event),
      event,
      config,
    })

    const raw = (db as unknown as { $client: ReturnType<typeof createClient> })
      .$client
    const subscription = await raw.execute(
      "SELECT plan_key, billing_source, subscription_status, dodo_subscription_id, billing_interval FROM workspace_subscriptions"
    )
    expect(subscription.rows).toEqual([
      {
        plan_key: "free",
        billing_source: "free",
        subscription_status: "free",
        dodo_subscription_id: null,
        billing_interval: null,
      },
    ])
    expect(grant).not.toHaveBeenCalled()
  })
})
