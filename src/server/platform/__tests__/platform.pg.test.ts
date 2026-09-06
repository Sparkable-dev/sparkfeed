import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { eq, sql } from "drizzle-orm"
import type { Database } from "@/db/client"
import { createDb } from "@/db/client"
import {
  creditLedger,
  feeds,
  member,
  organization,
  user,
  workspaceOverrides,
  workspaceSubscriptions,
} from "@/db/schema"

let database: Database
vi.mock("@/db/index", () => ({
  get db() {
    return database
  },
}))
const { workspacePage, userPage } = await import("../queries")
const { listQuerySchema } = await import("../contracts")
const { changeWorkspaceOverride } = await import("../overrides")
const { hostedMembership, deleteHostedUsers } =
  await import("../hosted-operations")
const { resolveEntitlements } = await import("@/server/entitlements/resolve")
const { grantWorkspaceAllowance } =
  await import("@/server/entitlements/allowances")
const { creditBalance } = await import("@/server/entitlements/credits")
const { reserveManagedAiCredits, releaseManagedAiCredits } =
  await import("@/server/billing/personal-credits")
const at = new Date("2026-09-05T12:00:00Z")
const prefix = `platform-qa-${randomUUID()}`
function identity(id: string) {
  return {
    id: `${prefix}-${id}`,
    name: `QA ${id}`,
    email: `${prefix}-${id}@example.test`,
    emailVerified: true,
    createdAt: at,
    updatedAt: at,
  }
}
const owner = identity("owner"),
  person = identity("personal"),
  other = identity("other"),
  third = identity("third")
const orgId = prefix + "-team"
const actor = { userId: "staff:test", email: "operator@example.test" }
const overrideDefaults = {
  planKey: null,
  accessRestriction: null,
  seatLimit: null,
  monthlyAiCredits: null,
  sourceUnitLimit: null,
  apiAccess: null,
  mcpAccess: null,
  reason: "Integration verification",
  expiresAt: null,
}

describe.runIf(process.env.RUN_PLATFORM_POSTGRES_TESTS === "true")(
  "private platform on PostgreSQL",
  () => {
    beforeAll(async () => {
      const url = process.env.DATABASE_URL
      if (!url || !new URL(url).pathname.endsWith("_qa"))
        throw new Error("Tests require a disposable *_qa database")
      database = createDb(url)
      process.env.SPARKFEED_EDITION = "cloud"
      await database
        .insert(user)
        .values([
          owner,
          person,
          other,
          third,
          ...Array.from({ length: 120 }, (_, i) =>
            identity(`page-${String(i).padStart(3, "0")}`)
          ),
        ])
      await database.transaction(async (tx) => {
        await tx
          .insert(organization)
          .values({ id: orgId, name: "QA team", slug: orgId, createdAt: at })
        await tx.insert(workspaceSubscriptions).values({
          workspaceType: "organization",
          workspaceId: orgId,
          planKey: "pro",
          billingSource: "manual",
          subscriptionStatus: "active",
          accessState: "active",
          paidSeatQuantity: 2,
          createdAt: at.toISOString(),
          updatedAt: at.toISOString(),
        })
        await tx.insert(member).values({
          id: prefix + "-owner-member",
          organizationId: orgId,
          userId: owner.id,
          role: "owner",
          createdAt: at,
        })
      })
      await database.insert(workspaceSubscriptions).values({
        workspaceType: "personal",
        workspaceId: person.id,
        planKey: "free",
        billingSource: "free",
        subscriptionStatus: "free",
        accessState: "active",
        paidSeatQuantity: 1,
        dodoCustomerId: prefix + "-customer",
        createdAt: at.toISOString(),
        updatedAt: at.toISOString(),
      })
      await database.insert(feeds).values(
        Array.from({ length: 7 }, (_, i) => ({
          id: `${prefix}-feed-${i}`,
          workspaceId: person.id,
          name: `Source ${i}`,
          url: `https://example.test/${i}`,
          kind: "page",
          createdAt: at.toISOString(),
        }))
      )
    })
    afterAll(async () => {
      if (database)
        await (
          database as unknown as { $client: { end: () => Promise<void> } }
        ).$client.end()
    })
    it("filters before pagination and inventories identities without subscriptions", async () => {
      const page = await userPage(listQuerySchema.parse({ q: prefix, page: 5 }))
      expect(page.total).toBe(124)
      expect(page.items.length).toBe(24)
      const workspace = await workspacePage(
        listQuerySchema.parse({ q: owner.email, type: "personal" })
      )
      expect(workspace.items[0]).toMatchObject({
        workspaceId: owner.id,
        missingSubscription: true,
      })
      const found = await userPage(
        listQuerySchema.parse({ q: identity("page-119").email })
      )
      expect(found.items).toHaveLength(1)
    })
    it("one remaining seat cannot be claimed by concurrent hosted additions", async () => {
      const results = await Promise.allSettled([
        hostedMembership(orgId, {
          action: "add",
          userId: other.id,
          role: "editor",
        }),
        hostedMembership(orgId, {
          action: "add",
          userId: third.id,
          role: "editor",
        }),
      ])
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
      const members = await database
        .select()
        .from(member)
        .where(eq(member.organizationId, orgId))
      expect(members).toHaveLength(2)
      const target = members.find((m) => m.role !== "owner")!
      await hostedMembership(orgId, {
        action: "role",
        memberId: target.id,
        role: "owner",
      })
      const owners = await database
        .select()
        .from(member)
        .where(
          sql`${member.organizationId}=${orgId} AND ${member.role}='owner'`
        )
      expect(owners).toHaveLength(1)
      expect(owners[0].id).toBe(target.id)
      await expect(
        hostedMembership(orgId, { action: "remove", memberId: target.id })
      ).rejects.toThrow("Transfer ownership")
    })
    it("complimentary access, source capacity and monthly credits share effective state", async () => {
      await changeWorkspaceOverride(
        {
          ...overrideDefaults,
          action: "set_override",
          workspaceType: "personal",
          workspaceId: person.id,
          planKey: "personal_plus",
          expectedRevision: 0,
        },
        actor
      )
      const principal = {
        type: "session" as const,
        userId: person.id,
        emailVerified: true,
        workspaceId: person.id,
        demo: false as const,
      }
      const first = await resolveEntitlements(
        { type: "personal", id: person.id },
        principal
      )
      expect(first).toMatchObject({
        plan: "personal_plus",
        apiAccess: true,
        sourceUnitCapacity: 50,
      })
      const amount = await creditBalance(
        { type: "personal", id: person.id },
        person.id,
        "paid"
      )
      expect(amount).toBe(100)
      await grantWorkspaceAllowance(
        { type: "personal", id: person.id },
        person.id
      )
      expect(
        await creditBalance(
          { type: "personal", id: person.id },
          person.id,
          "paid"
        )
      ).toBe(100)
      const held = await reserveManagedAiCredits(
        { type: "personal", id: person.id },
        person.id,
        randomUUID()
      )
      expect(held).not.toBeNull()
      await releaseManagedAiCredits(held!)
      const [billing] = await database
        .select()
        .from(workspaceSubscriptions)
        .where(eq(workspaceSubscriptions.workspaceId, person.id))
      expect(billing).toMatchObject({
        planKey: "free",
        billingSource: "free",
        dodoCustomerId: prefix + "-customer",
      })
    })
    it("stale override writes fail; billing updates do not remove suspension", async () => {
      await changeWorkspaceOverride(
        {
          ...overrideDefaults,
          action: "set_override",
          workspaceType: "personal",
          workspaceId: person.id,
          planKey: "personal_plus",
          accessRestriction: "suspended",
          expectedRevision: 1,
        },
        actor
      )
      await expect(
        changeWorkspaceOverride(
          {
            ...overrideDefaults,
            action: "set_override",
            workspaceType: "personal",
            workspaceId: person.id,
            expectedRevision: 1,
          },
          actor
        )
      ).rejects.toThrow("changed")
      await database
        .update(workspaceSubscriptions)
        .set({
          planKey: "personal_plus",
          billingSource: "dodo",
          subscriptionStatus: "active",
          accessState: "active",
        })
        .where(eq(workspaceSubscriptions.workspaceId, person.id))
      const principal = {
        type: "session" as const,
        userId: person.id,
        emailVerified: true,
        workspaceId: person.id,
        demo: false as const,
      }
      expect(
        await resolveEntitlements(
          { type: "personal", id: person.id },
          principal
        )
      ).toMatchObject({ accessState: "suspended", apiAccess: false })
      expect(
        await reserveManagedAiCredits(
          { type: "personal", id: person.id },
          person.id,
          randomUUID()
        )
      ).toBeNull()
      await expect(deleteHostedUsers([person.id])).rejects.toThrow(
        "Cancel the subscription"
      )
      await database
        .update(workspaceSubscriptions)
        .set({
          planKey: "free",
          subscriptionStatus: "free",
          billingSource: "free",
        })
        .where(eq(workspaceSubscriptions.workspaceId, person.id))
      await changeWorkspaceOverride(
        {
          action: "remove_override",
          workspaceType: "personal",
          workspaceId: person.id,
          expectedRevision: 2,
          reason: "Restore current billing",
        },
        actor
      )
      expect(
        await resolveEntitlements(
          { type: "personal", id: person.id },
          principal
        )
      ).toMatchObject({ plan: "free", apiAccess: false, sourceUnitCapacity: 5 })
      const sources = await database
        .select()
        .from(feeds)
        .where(eq(feeds.workspaceId, person.id))
      expect(
        sources.filter((s) => s.entitlementPausedAt === null)
      ).toHaveLength(5)
      const [stored] = await database
        .select()
        .from(workspaceOverrides)
        .where(eq(workspaceOverrides.workspaceId, person.id))
      expect(stored.revision).toBe(3)
    })
    it("an annual subscription earns monthly without repeating the period grant", async () => {
      await database
        .update(workspaceSubscriptions)
        .set({
          planKey: "personal_plus",
          subscriptionStatus: "active",
          billingSource: "dodo",
          billingInterval: "annual",
          currentPeriodStart: at.toISOString(),
        })
        .where(eq(workspaceSubscriptions.workspaceId, person.id))
      await grantWorkspaceAllowance(
        { type: "personal", id: person.id },
        person.id,
        new Date("2026-10-06T12:00:00Z")
      )
      const entries = await database
        .select()
        .from(creditLedger)
        .where(
          sql`${creditLedger.workspaceId}=${person.id} AND ${creditLedger.entryType}='grant' AND ${creditLedger.creditBucket}='paid'`
        )
      expect(entries).toHaveLength(2)
      await grantWorkspaceAllowance(
        { type: "personal", id: person.id },
        person.id,
        new Date("2026-10-06T12:00:00Z")
      )
      expect(
        await creditBalance(
          { type: "personal", id: person.id },
          person.id,
          "paid"
        )
      ).toBe(200)
    })
    it("does not refill held credits or replay a capped monthly grant", async () => {
      const workspace = { type: "personal" as const, id: person.id }
      await grantWorkspaceAllowance(
        workspace,
        person.id,
        new Date("2026-11-06T12:00:00Z")
      )
      expect(await creditBalance(workspace, person.id, "paid")).toBe(300)
      const held = await reserveManagedAiCredits(
        workspace,
        person.id,
        randomUUID()
      )
      expect(held).not.toBeNull()
      expect(
        await grantWorkspaceAllowance(
          workspace,
          person.id,
          new Date("2026-12-06T12:00:00Z")
        )
      ).toBe(0)
      await releaseManagedAiCredits(held!)
      expect(await creditBalance(workspace, person.id, "paid")).toBe(300)
      await database.insert(creditLedger).values({
        id: randomUUID(),
        workspaceType: "personal",
        workspaceId: person.id,
        beneficiaryUserId: person.id,
        creditBucket: "paid",
        amount: -50,
        entryType: "adjustment",
        reason: "QA spend",
        idempotencyKey: randomUUID(),
        createdAt: new Date().toISOString(),
      })
      expect(
        await grantWorkspaceAllowance(
          workspace,
          person.id,
          new Date("2026-12-06T12:00:00Z")
        )
      ).toBe(0)
      expect(await creditBalance(workspace, person.id, "paid")).toBe(250)
    })
    it("removing an expired override preserves its original retention deadline", async () => {
      const expired = new Date(Date.now() - 40 * 86400000).toISOString()
      await database.insert(workspaceSubscriptions).values({
        workspaceType: "personal",
        workspaceId: other.id,
        planKey: "free",
        billingSource: "free",
        subscriptionStatus: "free",
        accessState: "active",
        createdAt: at.toISOString(),
        updatedAt: at.toISOString(),
      })
      await database.insert(workspaceOverrides).values({
        ...overrideDefaults,
        workspaceType: "personal",
        workspaceId: other.id,
        planKey: "personal_plus",
        actorId: actor.userId,
        expiresAt: expired,
        revision: 1,
        createdAt: expired,
        updatedAt: expired,
      })
      await changeWorkspaceOverride(
        {
          action: "remove_override",
          workspaceType: "personal",
          workspaceId: other.id,
          expectedRevision: 1,
          reason: "Remove expired complimentary plan",
        },
        actor
      )
      const [billing] = await database
        .select()
        .from(workspaceSubscriptions)
        .where(eq(workspaceSubscriptions.workspaceId, other.id))
      expect(billing.paidCreditRetentionEndsAt).toBe(
        new Date(Date.parse(expired) + 30 * 86400000).toISOString()
      )
      await database.insert(creditLedger).values({
        id: randomUUID(),
        workspaceType: "personal",
        workspaceId: other.id,
        beneficiaryUserId: other.id,
        creditBucket: "paid",
        amount: 100,
        entryType: "grant",
        reason: "Expired QA allowance",
        idempotencyKey: randomUUID(),
        createdAt: expired,
      })
      const { refreshPersonalSubscriptionLifecycle } =
        await import("@/server/billing/personal-lifecycle")
      await refreshPersonalSubscriptionLifecycle(other.id)
      expect(
        await creditBalance(
          { type: "personal", id: other.id },
          other.id,
          "paid"
        )
      ).toBe(0)
    })
    it("an old payment replay does not create historical complimentary grants", async () => {
      const { grantPersonalMonthlyCredits } =
        await import("@/server/billing/personal-credits")
      const before = await database
        .select()
        .from(creditLedger)
        .where(
          sql`${creditLedger.workspaceId}=${person.id} AND ${creditLedger.entryType}='grant'`
        )
      await grantPersonalMonthlyCredits(person.id, "2025-01-01T00:00:00Z")
      const after = await database
        .select()
        .from(creditLedger)
        .where(
          sql`${creditLedger.workspaceId}=${person.id} AND ${creditLedger.entryType}='grant'`
        )
      expect(after.length).toBe(before.length)
    })
  }
)
