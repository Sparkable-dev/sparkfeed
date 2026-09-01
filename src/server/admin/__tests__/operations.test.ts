import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { createClient } from "@libsql/client"
import type { Database } from "@/db/client"
import { createDb } from "@/db/client"

let db: Database
let testDirectory: string
const banUser = vi.fn()
const unbanUser = vi.fn()
const revokeUserSession = vi.fn()
const requestPasswordReset = vi.fn()
const retrieveSubscription = vi.fn()
const reconcile = vi.fn().mockResolvedValue(undefined)

vi.mock("@/db/index", () => ({
  get db() {
    return db
  },
}))
vi.mock("@/lib/auth", () => ({
  auth: {
    api: { banUser, unbanUser, revokeUserSession, requestPasswordReset },
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

const { executeAdminMutation } = await import("../operations")

const actor = { userId: "admin-1", email: "admin@example.com" }
const request = new Request(
  "https://admin.sparkfeed.dev/api/platform-admin/mutations",
  {
    method: "POST",
    headers: {
      origin: "https://admin.sparkfeed.dev",
      cookie: "session=opaque",
    },
  }
)

function raw() {
  return (db as unknown as { $client: ReturnType<typeof createClient> }).$client
}

beforeEach(async () => {
  process.env.SPARKFEED_EDITION = "cloud"
  process.env.SPARKFEED_SURFACE = "admin"
  vi.clearAllMocks()
  testDirectory = mkdtempSync(join(tmpdir(), "sparkfeed-admin-"))
  db = createDb(`file:${join(testDirectory, "admin.db")}`, { sqlite: true })
  const sql = raw()
  await sql.execute(`CREATE TABLE user (
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

  banUser.mockImplementation(async () => {
    const { session: authSession, user: authUser } = await import("@/db/schema")
    const { eq } = await import("drizzle-orm")
    await db
      .update(authUser)
      .set({ banned: true, banReason: "security review" })
      .where(eq(authUser.id, "user-1"))
    await db.delete(authSession).where(eq(authSession.userId, "user-1"))
    return { user: { id: "user-1" } }
  })
  revokeUserSession.mockImplementation(
    async ({ body }: { body: { sessionToken: string } }) => {
      const { session: authSession } = await import("@/db/schema")
      const { eq } = await import("drizzle-orm")
      await db
        .delete(authSession)
        .where(eq(authSession.token, body.sessionToken))
      return { success: true }
    }
  )
  retrieveSubscription.mockResolvedValue({
    subscription_id: "sub-1",
    status: "active",
  })
})

afterEach(async () => {
  await raw().close()
  rmSync(testDirectory, { recursive: true, force: true })
  delete process.env.SPARKFEED_EDITION
  delete process.env.SPARKFEED_SURFACE
})

describe("approved admin mutations", () => {
  it("bans a user through Better Auth, revokes sessions, and never audits the token", async () => {
    await executeAdminMutation(request, actor, {
      action: "ban_user",
      targetUserId: "user-1",
      reason: "security review",
    })
    expect(banUser).toHaveBeenCalledOnce()
    const sql = await raw()
    expect(
      (await sql.execute("SELECT banned FROM user WHERE id='user-1'")).rows
    ).toEqual([{ banned: 1 }])
    expect((await sql.execute("SELECT id FROM session")).rows).toEqual([])
    const audit = await sql.execute(
      "SELECT reason, before_state, after_state FROM platform_admin_audit_log"
    )
    expect(audit.rows[0]?.reason).toBe("security review")
    expect(JSON.stringify(audit.rows)).not.toContain("never-audited-token")
  })

  it("revokes a selected session through Better Auth Admin", async () => {
    await executeAdminMutation(request, actor, {
      action: "revoke_session",
      sessionId: "session-1",
      reason: "device lost",
    })
    expect(revokeUserSession).toHaveBeenCalledWith(
      expect.objectContaining({ body: { sessionToken: "never-audited-token" } })
    )
    expect(
      (await (await raw()).execute("SELECT id FROM session")).rows
    ).toEqual([])
  })

  it("suspends and reactivates a workspace with an audit reason", async () => {
    await executeAdminMutation(request, actor, {
      action: "suspend_workspace",
      workspaceType: "personal",
      workspaceId: "user-1",
      reason: "abuse investigation",
    })
    await executeAdminMutation(request, actor, {
      action: "reactivate_workspace",
      workspaceType: "personal",
      workspaceId: "user-1",
      reason: "investigation cleared",
    })
    const sql = await raw()
    expect(
      (await sql.execute("SELECT access_state FROM workspace_subscriptions"))
        .rows
    ).toEqual([{ access_state: "active" }])
    expect(
      (
        await sql.execute(
          "SELECT action FROM platform_admin_audit_log ORDER BY created_at"
        )
      ).rows
    ).toHaveLength(2)
  })

  it("appends a credit adjustment with the actor and reason", async () => {
    await executeAdminMutation(request, actor, {
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
        actor_user_id: "admin-1",
        reason: "reverse duplicate support grant",
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

    await executeAdminMutation(request, actor, {
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

  it("replays a failed webhook by retrieving and reconciling current subscription state", async () => {
    const sql = await raw()
    await sql.execute(`INSERT INTO dodo_webhook_inbox (
      webhook_id, event_type, event_time, payload_hash, subject_type, subject_id,
      dodo_subscription_id, processing_status, attempt_count, received_at)
      VALUES ('wh-1', 'subscription.active', '2026-08-30T10:00:00Z', 'hash',
      'personal', 'user-1', 'sub-1', 'failed', 1, '2026-08-30T10:00:00Z')`)
    await executeAdminMutation(request, actor, {
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
