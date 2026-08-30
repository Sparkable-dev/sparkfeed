import { beforeEach, describe, expect, it, vi } from "vitest"
import type { createClient } from "@libsql/client"
import type DodoPayments from "dodopayments"
import type { Database } from "@/db/client"
import { createDb } from "@/db/client"

let db: Database
const reconcile = vi.fn().mockResolvedValue(undefined)

vi.mock("@/db/index", () => ({
  get db() {
    return db
  },
}))
vi.mock("../personal-webhooks", () => ({
  reconcilePersonalSubscriptionFromDodo: reconcile,
}))

const { reconcilePendingPersonalCheckout } = await import(
  "../personal-reconciliation"
)

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

beforeEach(async () => {
  reconcile.mockClear()
  db = createDb(":memory:", { sqlite: true })
  const raw = (db as unknown as { $client: ReturnType<typeof createClient> })
    .$client
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

  const { workspaceSubscriptions } = await import("@/db/schema")
  const now = new Date().toISOString()
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
    createdAt: now,
    updatedAt: now,
  })
})

describe("pending Personal+ reconciliation", () => {
  it("retrieves and reconciles the latest completed subscription", async () => {
    const list = vi.fn().mockResolvedValue({
      items: [
        {
          subscription_id: "sub-active",
          customer: { customer_id: "cus-1" },
          product_id: "product-monthly",
          status: "active",
          created_at: "2026-08-30T13:51:50.245Z",
          metadata: {
            billingSubjectType: "personal",
            billingSubjectId: "user-1",
          },
        },
      ],
    })
    const subscription = { subscription_id: "sub-active", status: "active" }
    const retrieve = vi.fn().mockResolvedValue(subscription)
    const client = {
      subscriptions: { list, retrieve },
    } as unknown as DodoPayments

    await expect(
      reconcilePendingPersonalCheckout("user-1", client, config)
    ).resolves.toBe(true)
    expect(list).toHaveBeenCalledWith({
      customer_id: "cus-1",
      page_number: 1,
      page_size: 20,
    })
    expect(retrieve).toHaveBeenCalledWith("sub-active")
    expect(reconcile).toHaveBeenCalledWith(
      subscription,
      expect.any(Date),
      config
    )
  })

  it("keeps waiting while Dodo still reports a pending subscription", async () => {
    const retrieve = vi.fn()
    const client = {
      subscriptions: {
        list: vi.fn().mockResolvedValue({
          items: [
            {
              subscription_id: "sub-pending",
              customer: { customer_id: "cus-1" },
              product_id: "product-monthly",
              status: "pending",
              created_at: "2026-08-30T13:51:50.245Z",
              metadata: {
                billingSubjectType: "personal",
                billingSubjectId: "user-1",
              },
            },
          ],
        }),
        retrieve,
      },
    } as unknown as DodoPayments

    await expect(
      reconcilePendingPersonalCheckout("user-1", client, config)
    ).resolves.toBe(false)
    expect(retrieve).not.toHaveBeenCalled()
    expect(reconcile).not.toHaveBeenCalled()
  })
})
