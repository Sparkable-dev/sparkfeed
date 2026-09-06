import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { createClient } from "@libsql/client"
import type { Database } from "@/db/client"
import { createDb } from "@/db/client"

let db: Database
let testDirectory: string
const retrieveSubscription = vi.fn()
const reconcile = vi.fn().mockResolvedValue(undefined)

vi.mock("@/db/index", () => ({
  get db() {
    return db
  },
}))
vi.mock("@/server/billing/dodo-client", () => ({
  dodoClient: () => ({ subscriptions: { retrieve: retrieveSubscription } }),
}))
vi.mock("@/server/billing/dodo-config", () => ({
  readDodoBillingConfig: () => ({
    apiKey: "test",
    webhookSecret: "test",
    environment: "test_mode",
    appUrl: "https://app.sparkfeed.dev",
    personalProducts: { monthly: "monthly", annual: "annual" },
  }),
}))
vi.mock("@/server/billing/personal-webhooks", () => ({
  reconcilePersonalSubscriptionFromDodo: reconcile,
}))

const { executeOperationalMutation } = await import("../operations")

const actor = { userId: "staff:operator-1", email: "admin@example.com" }
function raw() {
  return (db as unknown as { $client: ReturnType<typeof createClient> }).$client
}

beforeEach(async () => {
  process.env.SPARKFEED_EDITION = "cloud"
  vi.clearAllMocks()
  testDirectory = mkdtempSync(join(tmpdir(), "sparkfeed-admin-"))
  db = createDb(`file:${join(testDirectory, "admin.db")}`, { sqlite: true })
  const sql = raw()
  await sql.execute(`CREATE TABLE user (last_active_at TEXT,
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL,
    email_verified INTEGER NOT NULL DEFAULT 0, image TEXT, dodo_customer_id TEXT,
    role TEXT NOT NULL DEFAULT 'user', banned INTEGER NOT NULL DEFAULT 0,
    ban_reason TEXT, ban_expires TEXT, two_factor_enabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
  await sql.execute(`CREATE TABLE session (
    id TEXT PRIMARY KEY, expires_at TEXT NOT NULL, token TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, ip_address TEXT,
    user_agent TEXT, user_id TEXT NOT NULL, active_organization_id TEXT,
    impersonated_by TEXT)`)
  await sql.execute(`CREATE TABLE organization (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL, logo TEXT,
    created_at TEXT NOT NULL, metadata TEXT)`)
  await sql.execute(`CREATE TABLE member (
    id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, user_id TEXT NOT NULL,
    role TEXT NOT NULL, created_at TEXT NOT NULL)`)
  await sql.execute(`CREATE TABLE invitation (
    id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, email TEXT NOT NULL,
    role TEXT, status TEXT NOT NULL, expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL, inviter_id TEXT NOT NULL)`)
  await sql.execute(
    `CREATE TABLE platform_activity_days (user_id TEXT, workspace_type TEXT, workspace_id TEXT, day TEXT, last_seen_at TEXT)`
  )
  await sql.execute(`CREATE TABLE workspace_overrides (
    workspace_type TEXT NOT NULL, workspace_id TEXT NOT NULL, plan_key TEXT,
    access_restriction TEXT, seat_limit INTEGER, monthly_ai_credits INTEGER,
    source_unit_limit INTEGER, api_access INTEGER, mcp_access INTEGER,
    reason TEXT NOT NULL, actor_id TEXT NOT NULL, expires_at TEXT,
    revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY(workspace_type, workspace_id))`)
  await sql.execute(`CREATE TABLE workspace_subscriptions (
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
  await sql.execute(`CREATE TABLE credit_ledger (
    id TEXT PRIMARY KEY, workspace_type TEXT NOT NULL, workspace_id TEXT NOT NULL,
    beneficiary_user_id TEXT, credit_bucket TEXT NOT NULL, amount INTEGER NOT NULL,
    entry_type TEXT NOT NULL, grant_period TEXT, ai_request_id TEXT, reason TEXT,
    actor_user_id TEXT, idempotency_key TEXT NOT NULL UNIQUE, expires_at TEXT,
    created_at TEXT NOT NULL)`)
  await sql.execute(`CREATE TABLE usage_counters (
    id TEXT PRIMARY KEY, workspace_type TEXT NOT NULL, workspace_id TEXT NOT NULL,
    beneficiary_user_id TEXT NOT NULL, metric TEXT NOT NULL, period_start TEXT NOT NULL,
    period_end TEXT NOT NULL, quantity INTEGER NOT NULL, updated_at TEXT NOT NULL)`)
  await sql.execute(`CREATE TABLE dodo_webhook_inbox (
    webhook_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, event_time TEXT NOT NULL,
    payload_hash TEXT NOT NULL, subject_type TEXT, subject_id TEXT,
    dodo_subscription_id TEXT, processing_status TEXT NOT NULL,
    attempt_count INTEGER NOT NULL, last_error TEXT, received_at TEXT NOT NULL,
    processing_started_at TEXT, processed_at TEXT)`)
  await sql.execute(`CREATE TABLE platform_admin_audit_log (
    id TEXT PRIMARY KEY, actor_user_id TEXT NOT NULL, action TEXT NOT NULL,
    target_type TEXT NOT NULL, target_id TEXT NOT NULL, reason TEXT NOT NULL,
    before_state TEXT, after_state TEXT, created_at TEXT NOT NULL)`)
  await sql.execute(`CREATE TABLE billing_requests (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL,
    company TEXT NOT NULL, message TEXT NOT NULL, requester_user_id TEXT,
    request_type TEXT NOT NULL DEFAULT 'create_workspace', workspace_name TEXT,
    expected_seats INTEGER, requested_plan TEXT, workspace_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending', decision_note TEXT,
    created_at TEXT, updated_at TEXT)`)

  const now = new Date("2026-08-30T10:00:00.000Z")
  const { user, session, workspaceSubscriptions } = await import("@/db/schema")
  await db.insert(user).values({
    id: "user-1",
    name: "Reader",
    email: "reader@example.com",
    emailVerified: true,
    role: "user",
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(session).values({
    id: "session-1",
    token: "never-audited-token",
    userId: "user-1",
    expiresAt: now,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(workspaceSubscriptions).values({
    workspaceType: "personal",
    workspaceId: "user-1",
    planKey: "personal_plus",
    billingSource: "dodo",
    subscriptionStatus: "active",
    accessState: "active",
    dodoSubscriptionId: "sub-1",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  })

  retrieveSubscription.mockResolvedValue({
    subscription_id: "sub-1",
    status: "active",
  })
})

afterEach(async () => {
  await raw().close()
  rmSync(testDirectory, { recursive: true, force: true })
  delete process.env.SPARKFEED_EDITION
})

describe("signed operator domain operations", () => {
  it("appends a credit adjustment with the actor and reason", async () => {
    await executeOperationalMutation(actor, {
      action: "adjust_credits",
      workspaceType: "personal",
      workspaceId: "user-1",
      beneficiaryUserId: "user-1",
      amount: -12,
      creditBucket: "paid",
      reason: "reverse duplicate support grant",
    })
    const entries = await (
      await raw()
    ).execute(
      "SELECT amount, entry_type, actor_user_id, reason FROM credit_ledger"
    )
    expect(entries.rows).toEqual([
      {
        amount: -12,
        entry_type: "adjustment",
        actor_user_id: "staff:operator-1",
        reason: "reverse duplicate support grant",
      },
    ])
  })

  it("changes only manual team plans and clears stale Enterprise overrides", async () => {
    const sql = await raw()
    await sql.execute(`INSERT INTO organization (id, name, slug, created_at)
      VALUES ('org-1', 'Research team', 'research-team', '2026-08-30T10:00:00Z')`)
    await sql.execute(`INSERT INTO member (id, organization_id, user_id, role, created_at)
      VALUES ('member-1', 'org-1', 'user-1', 'owner', '2026-08-30T10:00:00Z')`)
    await sql.execute(`INSERT INTO workspace_subscriptions (
      workspace_type, workspace_id, plan_key, billing_source,
      subscription_status, access_state, paid_seat_quantity,
      override_seat_limit, override_monthly_ai_credits, override_api_access,
      created_at, updated_at)
      VALUES ('organization', 'org-1', 'enterprise', 'manual', 'active',
      'active', 20, 20, 500, 1, '2026-08-30T10:00:00Z',
      '2026-08-30T10:00:00Z')`)

    await executeOperationalMutation(actor, {
      action: "set_workspace_plan",
      workspaceType: "organization",
      workspaceId: "org-1",
      planKey: "pro",
      seatCapacity: 8,
      reason: "customer moved to Pro",
    })

    expect(
      (
        await sql.execute(
          "SELECT plan_key, paid_seat_quantity, override_seat_limit, override_monthly_ai_credits, override_api_access FROM workspace_subscriptions WHERE workspace_id='org-1'"
        )
      ).rows
    ).toEqual([
      {
        plan_key: "pro",
        paid_seat_quantity: 8,
        override_seat_limit: null,
        override_monthly_ai_credits: null,
        override_api_access: null,
      },
    ])
  })

  it("approves a tracked team request with one Owner and manual entitlements", async () => {
    const sql = await raw()
    await sql.execute(`INSERT INTO billing_requests (
      id, name, email, company, message, requester_user_id, request_type,
      workspace_name, expected_seats, status, created_at, updated_at)
      VALUES ('request-1', 'Reader', 'reader@example.com', 'Research team', '',
      'user-1', 'create_workspace', 'Research team', 5, 'pending',
      '2026-08-30T10:00:00Z', '2026-08-30T10:00:00Z')`)

    await executeOperationalMutation(actor, {
      action: "approve_team_request",
      requestId: "request-1",
      planKey: "pro",
      seatCapacity: 5,
      decisionNote: "Approved for beta",
      reason: "approved customer request",
    })

    expect(
      (await sql.execute("SELECT name, slug FROM organization")).rows
    ).toEqual([{ name: "Research team", slug: "research-team" }])
    expect(
      (await sql.execute("SELECT user_id, role FROM member")).rows
    ).toEqual([{ user_id: "user-1", role: "owner" }])
    expect(
      (
        await sql.execute(
          "SELECT plan_key, billing_source, paid_seat_quantity FROM workspace_subscriptions WHERE workspace_type='organization'"
        )
      ).rows
    ).toEqual([
      { plan_key: "pro", billing_source: "manual", paid_seat_quantity: 5 },
    ])
    expect(
      (
        await sql.execute(
          "SELECT status, requested_plan, workspace_id FROM billing_requests"
        )
      ).rows[0]
    ).toEqual(
      expect.objectContaining({
        status: "approved",
        requested_plan: "pro",
      })
    )
  })

  it("approves a team-plan cancellation without replacement-plan inputs", async () => {
    const sql = await raw()
    await sql.execute(`INSERT INTO organization (id, name, slug, created_at)
      VALUES ('org-cancel', 'Cancel team', 'cancel-team', '2026-08-30T10:00:00Z')`)
    await sql.execute(`INSERT INTO workspace_subscriptions (
      workspace_type, workspace_id, plan_key, billing_source,
      subscription_status, access_state, paid_seat_quantity, created_at, updated_at)
      VALUES ('organization', 'org-cancel', 'pro', 'manual', 'active',
      'active', 5, '2026-08-30T10:00:00Z', '2026-08-30T10:00:00Z')`)
    await sql.execute(`INSERT INTO billing_requests (
      id, name, email, company, message, requester_user_id, request_type,
      workspace_name, workspace_id, status, created_at, updated_at)
      VALUES ('request-cancel', 'Reader', 'reader@example.com', 'Cancel team', '',
      'user-1', 'cancel_plan', 'Cancel team', 'org-cancel', 'pending',
      '2026-08-30T10:00:00Z', '2026-08-30T10:00:00Z')`)

    await executeOperationalMutation(actor, {
      action: "approve_team_cancellation",
      requestId: "request-cancel",
      decisionNote: "Cancellation approved for the end of beta.",
      reason: "owner requested cancellation",
    })

    expect(
      (
        await sql.execute(
          "SELECT subscription_status, access_state FROM workspace_subscriptions WHERE workspace_id='org-cancel'"
        )
      ).rows
    ).toEqual([{ subscription_status: "canceled", access_state: "read_only" }])
    expect(
      (
        await sql.execute(
          "SELECT status, decision_note FROM billing_requests WHERE id='request-cancel'"
        )
      ).rows
    ).toEqual([
      {
        status: "approved",
        decision_note: "Cancellation approved for the end of beta.",
      },
    ])
  })

  it("moves a team request through review and decline with a customer note", async () => {
    const sql = await raw()
    await sql.execute(`INSERT INTO billing_requests (
      id, name, email, company, message, requester_user_id, request_type,
      workspace_name, expected_seats, status, created_at, updated_at)
      VALUES ('request-2', 'Reader', 'reader@example.com', 'Research team', '',
      'user-1', 'create_workspace', 'Research team', 5, 'pending',
      '2026-08-30T10:00:00Z', '2026-08-30T10:00:00Z')`)

    await executeOperationalMutation(actor, {
      action: "mark_team_request_in_review",
      requestId: "request-2",
      reason: "review started",
    })
    await executeOperationalMutation(actor, {
      action: "decline_team_request",
      requestId: "request-2",
      decisionNote: "Not available during the private beta.",
      reason: "beta capacity",
    })

    expect(
      (
        await sql.execute(
          "SELECT status, decision_note FROM billing_requests WHERE id='request-2'"
        )
      ).rows
    ).toEqual([
      {
        status: "declined",
        decision_note: "Not available during the private beta.",
      },
    ])
  })

  it("reconciles a Personal+ subscription from Dodo", async () => {
    await executeOperationalMutation(actor, {
      action: "reconcile_subscription",
      workspaceType: "personal",
      workspaceId: "user-1",
      reason: "support reconciliation",
    })
    expect(retrieveSubscription).toHaveBeenCalledWith("sub-1")
    expect(reconcile).toHaveBeenCalledOnce()
  })

  it("replays a failed webhook by retrieving and reconciling current subscription state", async () => {
    const sql = await raw()
    await sql.execute(`INSERT INTO dodo_webhook_inbox (
      webhook_id, event_type, event_time, payload_hash, subject_type, subject_id,
      dodo_subscription_id, processing_status, attempt_count, received_at)
      VALUES ('wh-1', 'subscription.active', '2026-08-30T10:00:00Z', 'hash',
      'personal', 'user-1', 'sub-1', 'failed', 1, '2026-08-30T10:00:00Z')`)
    await executeOperationalMutation(actor, {
      action: "replay_webhook",
      webhookId: "wh-1",
      reason: "provider recovered",
    })
    expect(retrieveSubscription).toHaveBeenCalledWith("sub-1")
    expect(reconcile).toHaveBeenCalledOnce()
    expect(
      (
        await sql.execute(
          "SELECT processing_status, attempt_count FROM dodo_webhook_inbox"
        )
      ).rows
    ).toEqual([{ processing_status: "processed", attempt_count: 2 }])
  })
})
