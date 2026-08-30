import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { createClient } from "@libsql/client"
import type { Database } from "@/db/client"
import { createDb } from "@/db/client"
import { personalWorkspaceRef } from "@/lib/workspaces"

let db: Database

vi.mock("@/db/index", () => ({
  get db() {
    return db
  },
}))

const { ensureCloudFreeAccount, freeCreditGrantKey } =
  await import("../credits")
const { assertNoRssSourceCapacity } = await import("../enforce")
const { planSupportsWorkspace, resolveEntitlements } =
  await import("../resolve")
const { clearRemovedOrganizationSessions } = await import("../organization")
const { canUserCreateWorkspace, registrationDecision } =
  await import("@/server/community-policy")

const USER_ID = "user-1"

beforeEach(async () => {
  process.env.SPARKFEED_EDITION = "cloud"
  delete process.env.SPARKFEED_SURFACE

  db = createDb(":memory:", { sqlite: true })
  const raw = (db as unknown as { $client: ReturnType<typeof createClient> })
    .$client

  await raw.execute(`CREATE TABLE organization (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL,
    logo TEXT, created_at TEXT, metadata TEXT)`)
  await raw.execute(`CREATE TABLE workspace_subscriptions (
    workspace_type TEXT NOT NULL, workspace_id TEXT NOT NULL,
    plan_key TEXT NOT NULL, billing_source TEXT NOT NULL,
    subscription_status TEXT NOT NULL, access_state TEXT NOT NULL,
    billing_interval TEXT, paid_seat_quantity INTEGER NOT NULL DEFAULT 1,
    scheduled_seat_quantity INTEGER, scheduled_seat_effective_at TEXT,
    current_period_start TEXT, current_period_end TEXT,
    failed_payment_grace_deadline TEXT, dodo_customer_id TEXT,
    paid_credit_retention_ends_at TEXT, provider_event_at TEXT,
    dodo_subscription_id TEXT, product_key TEXT,
    override_seat_limit INTEGER, override_monthly_ai_credits INTEGER,
    override_source_unit_limit INTEGER, override_api_access INTEGER,
    override_mcp_access INTEGER, created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace_type, workspace_id))`)
  await raw.execute(`CREATE TABLE credit_ledger (
    id TEXT PRIMARY KEY, workspace_type TEXT NOT NULL,
    workspace_id TEXT NOT NULL, beneficiary_user_id TEXT,
    credit_bucket TEXT NOT NULL,
    amount INTEGER NOT NULL, entry_type TEXT NOT NULL,
    grant_period TEXT, ai_request_id TEXT, reason TEXT,
    actor_user_id TEXT, idempotency_key TEXT NOT NULL UNIQUE,
    expires_at TEXT, created_at TEXT NOT NULL)`)
  await raw.execute(`CREATE TABLE feeds (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL,
    folder_id TEXT, workspace_id TEXT, kind TEXT NOT NULL DEFAULT 'rss',
    include_keywords TEXT, exclude_keywords TEXT, position INTEGER,
    created_at TEXT, last_fetched_at TEXT, last_error TEXT,
    last_error_at TEXT, entitlement_paused_at TEXT)`)
  await raw.execute(`CREATE TABLE session (
    id TEXT PRIMARY KEY, expires_at TEXT NOT NULL, token TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    ip_address TEXT, user_agent TEXT, user_id TEXT NOT NULL,
    active_organization_id TEXT, impersonated_by TEXT)`)
  await raw.execute(`CREATE TABLE user (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL,
    email_verified INTEGER NOT NULL DEFAULT 0, image TEXT, dodo_customer_id TEXT,
    role TEXT NOT NULL DEFAULT 'user', banned INTEGER NOT NULL DEFAULT 0,
    ban_reason TEXT, ban_expires TEXT, two_factor_enabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
  await raw.execute(`CREATE TABLE invitation (
    id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, email TEXT NOT NULL,
    role TEXT, status TEXT NOT NULL, expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL, inviter_id TEXT NOT NULL)`)
})

afterEach(() => {
  delete process.env.SPARKFEED_EDITION
  delete process.env.SPARKFEED_SURFACE
})

function sessionPrincipal(verified: boolean) {
  return {
    type: "session" as const,
    userId: USER_ID,
    emailVerified: verified,
    workspaceId: USER_ID,
    demo: false as const,
  }
}

describe("Cloud Free account and entitlement integration", () => {
  it("maps personal and organization plans to the approved workspace types", () => {
    expect(planSupportsWorkspace("free", "personal")).toBe(true)
    expect(planSupportsWorkspace("personal_plus", "personal")).toBe(true)
    expect(planSupportsWorkspace("pro", "organization")).toBe(true)
    expect(planSupportsWorkspace("enterprise", "organization")).toBe(true)
    expect(planSupportsWorkspace("free", "organization")).toBe(false)
    expect(planSupportsWorkspace("pro", "personal")).toBe(false)
  })

  it("creates the personal Free record and grants 50 credits once after verification", async () => {
    const workspace = personalWorkspaceRef(USER_ID)

    const first = await resolveEntitlements(workspace, sessionPrincipal(true))
    const second = await resolveEntitlements(workspace, sessionPrincipal(true))

    expect(first).toMatchObject({
      plan: "free",
      accessState: "active",
      seatCapacity: 1,
      sourceUnitCapacity: 5,
      apiAccess: false,
      mcpAccess: false,
      canCreateOrganizations: false,
      canManageInvitations: false,
      managedAiAccess: true,
      sparkAiCreditBalance: 50,
    })
    expect(second.sparkAiCreditBalance).toBe(50)

    const raw = (db as unknown as { $client: ReturnType<typeof createClient> })
      .$client
    const subscriptions = await raw.execute(
      "SELECT * FROM workspace_subscriptions"
    )
    const grants = await raw.execute(
      "SELECT idempotency_key FROM credit_ledger"
    )
    expect(subscriptions.rows).toHaveLength(1)
    expect(grants.rows).toEqual([
      { idempotency_key: freeCreditGrantKey(USER_ID) },
    ])
  })

  it("does not grant credits or managed AI before email verification", async () => {
    const result = await resolveEntitlements(
      personalWorkspaceRef(USER_ID),
      sessionPrincipal(false)
    )

    expect(result.sparkAiCreditBalance).toBe(0)
    expect(result.managedAiAccess).toBe(false)
  })

  it("keeps direct Cloud signup open and blocks organization creation", async () => {
    await expect(registrationDecision("direct@example.com")).resolves.toEqual({
      allowed: true,
      reason: "open",
    })
    await expect(canUserCreateWorkspace(USER_ID)).resolves.toBe(false)
  })

  it("enforces five active no-RSS sources while leaving RSS unlimited", async () => {
    await ensureCloudFreeAccount(personalWorkspaceRef(USER_ID), USER_ID, true)
    const { feeds } = await import("@/db/schema")
    await db.insert(feeds).values(
      Array.from({ length: 5 }, (_, index) => ({
        id: `page-${index}`,
        name: `Page ${index}`,
        url: `https://example.com/${index}`,
        workspaceId: USER_ID,
        kind: "page",
      }))
    )

    await expect(assertNoRssSourceCapacity(USER_ID, 1)).rejects.toThrow(
      "5 active website sources"
    )
    await expect(assertNoRssSourceCapacity(USER_ID, 0)).resolves.toBeUndefined()
  })
})

describe("Community and workspace lifecycle integration", () => {
  it("keeps the full Community contract without subscription records", async () => {
    process.env.SPARKFEED_EDITION = "community"
    const result = await resolveEntitlements(
      personalWorkspaceRef(USER_ID),
      sessionPrincipal(false)
    )

    expect(result).toMatchObject({
      plan: "community",
      apiAccess: true,
      mcpAccess: true,
      managedAiAccess: true,
      canCreateOrganizations: true,
      canManageInvitations: true,
      sourceUnitCapacity: null,
    })
  })

  it("keeps Community invitation-only signup working through Better Auth invitations", async () => {
    process.env.SPARKFEED_EDITION = "community"
    const { invitation, user } = await import("@/db/schema")
    const now = new Date()
    await db.insert(user).values({
      id: "owner",
      name: "Owner",
      email: "owner@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(invitation).values({
      id: "invite-1",
      organizationId: "org-1",
      email: "invited@example.com",
      role: "member",
      status: "pending",
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: now,
      inviterId: "owner",
    })

    await expect(registrationDecision("invited@example.com")).resolves.toEqual({
      allowed: true,
      reason: "invited",
    })
  })

  it("falls every removed member session back to the personal workspace", async () => {
    const { session } = await import("@/db/schema")
    const now = new Date()
    await db.insert(session).values([
      {
        id: "session-1",
        token: "token-1",
        userId: USER_ID,
        activeOrganizationId: "org-1",
        expiresAt: now,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "session-2",
        token: "token-2",
        userId: USER_ID,
        activeOrganizationId: "org-2",
        expiresAt: now,
        createdAt: now,
        updatedAt: now,
      },
    ])

    await clearRemovedOrganizationSessions(USER_ID, "org-1")
    const raw = (db as unknown as { $client: ReturnType<typeof createClient> })
      .$client
    const result = await raw.execute(
      "SELECT id, active_organization_id FROM session ORDER BY id"
    )
    expect(result.rows).toEqual([
      { id: "session-1", active_organization_id: null },
      { id: "session-2", active_organization_id: "org-2" },
    ])
  })
})
