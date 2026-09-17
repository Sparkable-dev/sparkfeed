import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { and, eq } from "drizzle-orm"
import type { Database } from "@/db/client"
import { createDb } from "@/db/client"
import {
  creditLedger,
  member,
  organization,
  platformAdminAuditLog,
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
const { changePlan } = await import("../plan-actions")
const { setCreditBalance, readCreditAccount } =
  await import("../credit-accounts")
const { manageWorkspaceMember } = await import("../workspace-actions")
const { userPage, userWorkspaces, workspacePage, platformOverview } =
  await import("../queries")
const { listQuerySchema } = await import("../contracts")
const { recordPlatformActivity } = await import("../activity")
const { ensureCloudFreeAccount } = await import("@/server/entitlements/credits")
const { reserveManagedAiCredits, releaseManagedAiCredits } =
  await import("@/server/billing/personal-credits")
const prefix = "simple-qa-" + randomUUID(),
  person = prefix + "-person",
  other = prefix + "-other",
  team = prefix + "-team",
  team2 = prefix + "-team2",
  actor = { userId: "staff:qa-operator", email: "operator@example.test" }
const personal = { type: "personal" as const, id: person }
const plan = (
  planKey: string | null,
  revision: number,
  extra: Record<string, unknown> = {}
) => ({
  action: "change_plan",
  workspaceType: "personal",
  workspaceId: person,
  planKey,
  expectedRevision: revision,
  reason: "QA plan edit",
  ...extra,
})
async function setBalance(value: number, revision?: string) {
  const current = await readCreditAccount(
    database,
    personal,
    person,
    "personal_plus"
  )
  return setCreditBalance(
    {
      action: "set_credit_balance",
      workspaceType: "personal",
      workspaceId: person,
      userId: person,
      balance: value,
      expectedPlan: "personal_plus",
      expectedRevision: revision ?? current.revision,
      reason: "QA absolute balance edit",
    },
    actor
  )
}
describe.runIf(process.env.RUN_PLATFORM_POSTGRES_TESTS === "true")(
  "simple plan and credit workflows on PostgreSQL",
  () => {
    beforeAll(async () => {
      const url = process.env.DATABASE_URL
      if (!url || !new URL(url).pathname.endsWith("_qa"))
        throw new Error("Use a disposable *_qa database")
      database = createDb(url)
      vi.stubEnv("SPARKFEED_EDITION", "cloud")
      await database.insert(user).values([
        {
          id: person,
          name: "Simple QA person",
          email: person + "@example.test",
          emailVerified: true,
        },
        {
          id: other,
          name: "Simple QA other",
          email: other + "@example.test",
          emailVerified: true,
        },
      ])
      await ensureCloudFreeAccount(personal, person, true)
      await database
        .update(workspaceSubscriptions)
        .set({
          dodoCustomerId: prefix + "-customer",
          dodoSubscriptionId: prefix + "-subscription",
        })
        .where(eq(workspaceSubscriptions.workspaceId, person))
      for (const id of [team, team2])
        await database.transaction(async (tx) => {
          await tx.insert(organization).values({ id, name: id, slug: id })
          await tx.insert(workspaceSubscriptions).values({
            workspaceType: "organization",
            workspaceId: id,
            planKey: "pro",
            billingSource: "manual",
            subscriptionStatus: "active",
            accessState: "active",
            paidSeatQuantity: 2,
          })
          await tx.insert(member).values([
            {
              id: id + "-owner",
              organizationId: id,
              userId: other,
              role: "owner",
            },
            {
              id: id + "-person",
              organizationId: id,
              userId: person,
              role: "editor",
            },
          ])
        })
    })
    afterAll(async () => {
      vi.unstubAllEnvs()
      if (database)
        await (
          database as unknown as { $client: { end: () => Promise<void> } }
        ).$client.end()
    })
    it("shows a personal membership plus every team and filters users through team plans", async () => {
      const memberships = await userWorkspaces(person)
      expect(memberships).toHaveLength(3)
      expect(
        memberships.filter((w) => w.workspaceType === "personal")[0].role
      ).toBe("owner")
      const page = await userPage(
        listQuerySchema.parse({ q: person, plan: "pro" })
      )
      expect(page.total).toBe(1)
      expect(page.items[0].workspaces).toHaveLength(3)
      const workspaces = await workspacePage(
        listQuerySchema.parse({ q: prefix })
      )
      expect(workspaces.items.some((w) => w.workspaceType === "personal")).toBe(
        true
      )
    })
    it("assigns Personal+ indefinitely, grants its allowance once, and preserves Dodo identity", async () => {
      await changePlan(plan("personal_plus", 0), actor)
      const [override] = await database
        .select()
        .from(workspaceOverrides)
        .where(eq(workspaceOverrides.workspaceId, person))
      expect(override.expiresAt).toBeNull()
      const [base] = await database
        .select()
        .from(workspaceSubscriptions)
        .where(eq(workspaceSubscriptions.workspaceId, person))
      expect(base).toMatchObject({
        planKey: "free",
        dodoCustomerId: prefix + "-customer",
        dodoSubscriptionId: prefix + "-subscription",
      })
      expect(
        (await readCreditAccount(database, personal, person, "personal_plus"))
          .available
      ).toBe(150)
      await changePlan(plan("personal_plus", 1), actor)
      expect(
        (await readCreditAccount(database, personal, person, "personal_plus"))
          .available
      ).toBe(150)
      expect(
        (await userWorkspaces(person))
          .filter((w) => w.workspaceType === "organization")
          .every((w) => w.effectivePlan === "pro")
      ).toBe(true)
    })
    it("sets an absolute balance through ledger entries and rejects competing stale edits", async () => {
      const before = await readCreditAccount(
        database,
        personal,
        person,
        "personal_plus"
      )
      const results = await Promise.allSettled([
        setBalance(240, before.revision),
        setBalance(320, before.revision),
      ])
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(1)
      const current = await readCreditAccount(
        database,
        personal,
        person,
        "personal_plus"
      )
      expect([240, 320]).toContain(current.available)
      expect(
        (
          await database
            .select()
            .from(creditLedger)
            .where(
              and(
                eq(creditLedger.workspaceId, person),
                eq(creditLedger.entryType, "grant")
              )
            )
        ).length
      ).toBeGreaterThanOrEqual(2)
      expect(
        (await userWorkspaces(person))
          .filter((w) => w.workspaceType === "organization")
          .every((w) => w.credits.available === 0)
      ).toBe(true)
    })
    it("does not edit credits reserved by an AI request", async () => {
      const hold = await reserveManagedAiCredits(personal, person, randomUUID())
      expect(hold).not.toBeNull()
      const current = await readCreditAccount(
        database,
        personal,
        person,
        "personal_plus"
      )
      expect(current.reserved).toBeGreaterThan(0)
      await expect(setBalance(500, current.revision)).rejects.toThrow(
        "AI request"
      )
      await releaseManagedAiCredits(hold!)
      expect(
        (await readCreditAccount(database, personal, person, "personal_plus"))
          .reserved
      ).toBe(0)
    })
    it("manual plans survive billing changes and returning to subscription uses current billing", async () => {
      await database
        .update(workspaceSubscriptions)
        .set({
          planKey: "personal_plus",
          billingSource: "dodo",
          subscriptionStatus: "active",
        })
        .where(eq(workspaceSubscriptions.workspaceId, person))
      await changePlan(plan("free", 2), actor)
      const memberships = await userWorkspaces(person)
      expect(
        memberships.find((w) => w.workspaceType === "personal")
      ).toMatchObject({
        effectivePlan: "free",
        billedPlan: "personal_plus",
        manualPlan: true,
      })
      const current = await readCreditAccount(
        database,
        personal,
        person,
        "personal_plus"
      )
      await expect(setBalance(400, current.revision)).rejects.toThrow(
        "plan changed"
      )
      await changePlan(plan(null, 3), actor)
      expect(
        (await userWorkspaces(person)).find(
          (w) => w.workspaceType === "personal"
        )
      ).toMatchObject({ effectivePlan: "personal_plus", manualPlan: false })
    })
    it("rejects personal/team conversion and reductions below occupied seats", async () => {
      await expect(changePlan(plan("pro", 4), actor)).rejects.toThrow(
        "workspace type"
      )
      await expect(
        changePlan(
          {
            action: "change_plan",
            workspaceType: "organization",
            workspaceId: team,
            planKey: "pro",
            seats: 1,
            expectedRevision: 0,
            reason: "QA reduce seats",
          },
          actor
        )
      ).rejects.toThrow("Remove members")
    })
    it("manages membership with staff attribution while preserving other memberships", async () => {
      await manageWorkspaceMember(
        {
          action: "manage_workspace_member",
          operation: "role",
          workspaceId: team,
          memberId: team + "-person",
          role: "owner",
          reason: "QA transfer owner",
        },
        actor
      )
      const owners = await database
        .select()
        .from(member)
        .where(and(eq(member.organizationId, team), eq(member.role, "owner")))
      expect(owners).toHaveLength(1)
      expect(owners[0].userId).toBe(person)
      const audits = await database
        .select()
        .from(platformAdminAuditLog)
        .where(
          and(
            eq(platformAdminAuditLog.targetId, team),
            eq(platformAdminAuditLog.action, "transfer_ownership")
          )
        )
      expect(audits[0].actorUserId).toBe(actor.userId)
      await manageWorkspaceMember(
        {
          action: "manage_workspace_member",
          operation: "remove",
          workspaceId: team2,
          memberId: team2 + "-person",
          reason: "QA remove membership",
        },
        actor
      )
      const remaining = await userWorkspaces(person)
      expect(remaining).toHaveLength(2)
      expect(remaining.some((w) => w.workspaceType === "personal")).toBe(true)
    })
    it("deduplicates observed active users across workspaces on the same UTC day", async () => {
      const before = await platformOverview(7)
      await recordPlatformActivity(person, personal)
      await recordPlatformActivity(person, { type: "organization", id: team })
      const stats = await platformOverview(7)
      const today = stats.series.at(-1) as { activeUsers: number }
      expect(today.activeUsers).toBeGreaterThan(0)
      expect(stats.activeUsers).toBe(Number(before.activeUsers) + 1)
      expect(stats.activitySince).not.toBeNull()
    })
    it("keeps the Pro allowance when assigning Enterprise without duplicating the month's credits", async () => {
      await changePlan(
        {
          action: "change_plan",
          workspaceType: "organization",
          workspaceId: team,
          planKey: "enterprise",
          seats: 2,
          expectedRevision: 0,
          reason: "QA upgrade team access",
        },
        actor
      )
      const first = await readCreditAccount(
        database,
        { type: "organization", id: team },
        person,
        "enterprise"
      )
      const [assignment] = await database
        .select()
        .from(workspaceOverrides)
        .where(eq(workspaceOverrides.workspaceId, team))
      expect(assignment.monthlyAiCredits).toBe(360)
      // New team members receive the existing joining-period proration.
      expect(first.available).toBeGreaterThan(0)
      expect(first.available).toBeLessThanOrEqual(360)
      await changePlan(
        {
          action: "change_plan",
          workspaceType: "organization",
          workspaceId: team,
          planKey: "pro",
          seats: 2,
          expectedRevision: 1,
          reason: "QA return team to Pro",
        },
        actor
      )
      expect(
        (
          await readCreditAccount(
            database,
            { type: "organization", id: team },
            person,
            "pro"
          )
        ).available
      ).toBe(first.available)
    })
    it("rolls back billing initialization when a new manual plan fails validation", async () => {
      const id = prefix + "-unassigned"
      await database.transaction(async (tx) => {
        await tx
          .insert(organization)
          .values({ id, name: "Unassigned team", slug: id })
        await tx.insert(member).values([
          {
            id: id + "-owner",
            organizationId: id,
            userId: other,
            role: "owner",
          },
          {
            id: id + "-member",
            organizationId: id,
            userId: person,
            role: "editor",
          },
        ])
      })
      await expect(
        changePlan(
          {
            action: "change_plan",
            workspaceType: "organization",
            workspaceId: id,
            planKey: "pro",
            seats: 1,
            expectedRevision: 0,
            reason: "QA reject undersized plan",
          },
          actor
        )
      ).rejects.toThrow("Remove members")
      expect(
        await database
          .select()
          .from(workspaceSubscriptions)
          .where(eq(workspaceSubscriptions.workspaceId, id))
      ).toHaveLength(0)
    })
    it("a staff-set Free balance remains exact after later email verification", async () => {
      const workspace = { type: "personal" as const, id: other }
      const current = await readCreditAccount(
        database,
        workspace,
        other,
        "free"
      )
      await setCreditBalance(
        {
          action: "set_credit_balance",
          workspaceType: "personal",
          workspaceId: other,
          userId: other,
          balance: 20,
          expectedPlan: "free",
          expectedRevision: current.revision,
          reason: "QA set initial balance",
        },
        actor
      )
      await ensureCloudFreeAccount(workspace, other, true)
      expect(
        (await readCreditAccount(database, workspace, other, "free")).available
      ).toBe(20)
    })
  }
)
