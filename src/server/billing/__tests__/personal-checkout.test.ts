import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { createClient } from "@libsql/client"
import type DodoPayments from "dodopayments"
import type { Database } from "@/db/client"
import { createDb } from "@/db/client"

let db: Database
let fixtureDir: string

vi.mock("@/db/index", () => ({
  get db() {
    return db
  },
}))

const { createPersonalCheckout } = await import("../personal-checkout")

beforeEach(async () => {
  fixtureDir = mkdtempSync(join(tmpdir(), "sparkfeed-personal-checkout-"))
  db = createDb(`file:${join(fixtureDir, "test.db")}`, { sqlite: true })
  const raw = (db as unknown as { $client: ReturnType<typeof createClient> })
    .$client
  await raw.execute(
    `CREATE TABLE personal_checkout_state (user_id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL, checkout_session_id TEXT, checkout_url TEXT, created_at TEXT NOT NULL)`
  )
  await raw.execute(`CREATE TABLE user (last_active_at TEXT,
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL,
    email_verified INTEGER NOT NULL, image TEXT, dodo_customer_id TEXT,
    role TEXT NOT NULL DEFAULT 'user', banned INTEGER NOT NULL DEFAULT 0,
    ban_reason TEXT, ban_expires TEXT, two_factor_enabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
  await raw.execute(`CREATE TABLE workspace_overrides (
    workspace_type TEXT NOT NULL, workspace_id TEXT NOT NULL, plan_key TEXT,
    access_restriction TEXT, seat_limit INTEGER, monthly_ai_credits INTEGER,
    source_unit_limit INTEGER, api_access INTEGER, mcp_access INTEGER,
    reason TEXT NOT NULL, actor_id TEXT NOT NULL, expires_at TEXT,
    revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY(workspace_type, workspace_id))`)
  await raw.execute(`CREATE TABLE workspace_credit_schedules (
    workspace_type TEXT NOT NULL, workspace_id TEXT NOT NULL, user_id TEXT NOT NULL,
    anchor_at TEXT NOT NULL, PRIMARY KEY(workspace_type, workspace_id, user_id))`)
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

  const { user } = await import("@/db/schema")
  const now = new Date()
  await db.insert(user).values({
    id: "user-1",
    name: "Sudu",
    email: "sudu@example.com",
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
})

afterEach(() => {
  ;(
    db as unknown as { $client: ReturnType<typeof createClient> }
  ).$client.close()
  rmSync(fixtureDir, { recursive: true, force: true })
})

describe("Personal+ checkout", () => {
  const config = {
    apiKey: "test-key",
    webhookSecret: "test-secret",
    environment: "test_mode" as const,
    appUrl: "https://app.sparkfeed.dev",
    personalProducts: { monthly: "product-monthly", annual: "product-annual" },
  }
  it("does not issue a second checkout after a lost response", async () => {
    const create = vi.fn().mockRejectedValue(new Error("response lost"))
    const client = {
      customers: {
        create: vi.fn().mockResolvedValue({ customer_id: "cus-1" }),
      },
      subscriptions: { list: () => ({ async *[Symbol.asyncIterator]() {} }) },
      checkoutSessions: { create },
    } as unknown as DodoPayments
    await expect(
      createPersonalCheckout("user-1", "monthly", client, config)
    ).rejects.toThrow("response lost")
    await expect(
      createPersonalCheckout("user-1", "monthly", client, config)
    ).rejects.toThrow("second checkout is blocked")
    expect(create).toHaveBeenCalledTimes(1)
  })
  it("recovers an existing subscription through the portal instead of replacing it", async () => {
    const create = vi.fn()
    const client = {
      customers: {
        create: vi.fn().mockResolvedValue({ customer_id: "cus-1" }),
      },
      subscriptions: {
        list: () => ({
          async *[Symbol.asyncIterator]() {
            yield await Promise.resolve({
              product_id: "product-monthly",
              status: "on_hold",
            })
          },
        }),
      },
      checkoutSessions: { create },
    } as unknown as DodoPayments
    await expect(
      createPersonalCheckout("user-1", "monthly", client, config)
    ).rejects.toThrow("Manage billing")
    expect(create).not.toHaveBeenCalled()
  })
  it("binds checkout to the server product and stable customer ID", async () => {
    const createCustomer = vi.fn().mockResolvedValue({ customer_id: "cus-1" })
    const createCheckout = vi.fn().mockResolvedValue({
      session_id: "cks-1",
      checkout_url: "https://checkout.example/cks-1",
    })
    const client = {
      subscriptions: { list: () => ({ async *[Symbol.asyncIterator]() {} }) },
      customers: { create: createCustomer },
      checkoutSessions: { create: createCheckout },
    } as unknown as DodoPayments
    const result = await createPersonalCheckout(
      "user-1",
      "annual",
      client,
      config
    )

    expect(result).toEqual({
      checkoutUrl: "https://checkout.example/cks-1",
      checkoutSessionId: "cks-1",
    })
    expect(
      await createPersonalCheckout("user-1", "annual", client, config)
    ).toEqual(result)
    expect(createCheckout).toHaveBeenCalledTimes(1)
    expect(createCustomer).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "sudu@example.com",
        metadata: expect.objectContaining({ billingSubjectId: "user-1" }),
      }),
      { maxRetries: 0 }
    )
    expect(createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        product_cart: [{ product_id: "product-annual", quantity: 1 }],
        customer: { customer_id: "cus-1" },
        metadata: expect.objectContaining({
          billingSubjectType: "personal",
          billingSubjectId: "user-1",
          productKey: "personal-annual",
        }),
      }),
      expect.objectContaining({ maxRetries: 0 })
    )

    const raw = (db as unknown as { $client: ReturnType<typeof createClient> })
      .$client
    const subscription = await raw.execute(
      "SELECT plan_key, subscription_status, dodo_customer_id, product_key FROM workspace_subscriptions"
    )
    expect(subscription.rows).toEqual([
      {
        plan_key: "free",
        subscription_status: "checkout_pending",
        dodo_customer_id: "cus-1",
        product_key: "personal-annual",
      },
    ])
  })
})
