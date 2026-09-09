import { createHmac, randomUUID } from "node:crypto"
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { and, eq, like } from "drizzle-orm"
import type { Database } from "@/db/client"
import { createDb } from "@/db/client"
import {
  invitation,
  member,
  organization,
  platformAdminAuditLog,
  session,
  user,
  workspaceOverrides,
  workspaceSubscriptions,
} from "@/db/schema"

let database: Database
const mail = vi.fn().mockResolvedValue(undefined)
const teamMail = vi.fn().mockResolvedValue(undefined)
vi.mock("@/server/billing/dodo-auth", () => ({
  dodoBetterAuthPlugin: () => null,
  assertPersonalPortalAllowed: vi.fn(),
}))
vi.mock("@/db/index", () => ({
  get db() {
    return database
  },
}))
vi.mock("@/lib/email", () => ({
  sendCustomerInviteEmail: mail,
  sendInviteEmail: teamMail,
  sendPasswordResetEmail: vi.fn(),
  sendVerificationEmail: vi.fn(),
}))
const { customerOperation } = await import("../customer-actions")
const { changeWorkspaceAccess } = await import("../workspace-actions")
const { getPlatformUser } = await import("../operations")
const prefix = "operator-" + randomUUID()
const actor = { userId: "staff:" + prefix, email: "operator@example.test" }
const owner = prefix + "-owner",
  other = prefix + "-other"
const team = prefix + "-team",
  second = prefix + "-second"
const invite = (email: string, workspaceId = team) => ({
  action: "invite_team_member",
  email,
  workspaceId,
  role: "editor",
  reason: "Owner requested access",
})

describe.runIf(process.env.RUN_PLATFORM_POSTGRES_TESTS === "true")(
  "operator improvements on PostgreSQL",
  () => {
    beforeAll(async () => {
      const url = process.env.DATABASE_URL
      if (!url || !new URL(url).pathname.endsWith("_qa"))
        throw new Error("Use a disposable *_qa database")
      database = createDb(url)
      vi.stubEnv("SPARKFEED_EDITION", "cloud")
      vi.stubEnv("SPARKFEED_ENVIRONMENT", "beta")
      vi.stubEnv("APP_URL", "https://beta.example.test")
      await database.insert(user).values([
        {
          id: owner,
          name: "Owner",
          email: owner + "@example.test",
          emailVerified: true,
        },
        {
          id: other,
          name: "Other",
          email: other + "@example.test",
          emailVerified: true,
        },
      ])
      for (const id of [team, second])
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
          await tx.insert(member).values({
            id: id + "-owner",
            organizationId: id,
            userId: owner,
            role: "owner",
          })
        })
    })
    beforeEach(() => {
      mail.mockClear()
      teamMail.mockClear()
    })
    afterAll(async () => {
      if (!database) return
      for (const id of [team, second])
        await database.delete(organization).where(eq(organization.id, id))
      await database
        .delete(workspaceOverrides)
        .where(like(workspaceOverrides.workspaceId, prefix + "%"))
      await database
        .delete(workspaceSubscriptions)
        .where(like(workspaceSubscriptions.workspaceId, prefix + "%"))
      await database.delete(user).where(like(user.id, prefix + "%"))
      await database
        .delete(platformAdminAuditLog)
        .where(eq(platformAdminAuditLog.actorUserId, actor.userId))
      vi.unstubAllEnvs()
    })
    it("sends Beta signup outreach without creating or verifying an account, and suppresses concurrent duplicates", async () => {
      const email = prefix + "-invite@example.test"
      const results = await Promise.allSettled(
        [1, 2].map(() =>
          customerOperation(
            { action: "invite_customer", email, reason: "Early access" },
            actor
          )
        )
      )
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
      expect(mail).toHaveBeenCalledExactlyOnceWith(
        email,
        `https://beta.example.test/signup?email=${encodeURIComponent(email)}`,
        true
      )
      expect(
        await database.select().from(user).where(eq(user.email, email))
      ).toHaveLength(0)
    })
    it("uses production copy only in the production environment", async () => {
      vi.stubEnv("SPARKFEED_ENVIRONMENT", "production")
      await customerOperation(
        {
          action: "invite_customer",
          email: prefix + "-prod@example.test",
          reason: "Welcome",
        },
        actor
      )
      expect(mail.mock.calls[0][2]).toBe(false)
      vi.stubEnv("SPARKFEED_ENVIRONMENT", "beta")
    })
    it("does not send outreach to an existing account", async () => {
      await expect(
        customerOperation(
          {
            action: "invite_customer",
            email: owner + "@example.test",
            reason: "Invite",
          },
          actor
        )
      ).rejects.toThrow("already has an account")
      expect(mail).not.toHaveBeenCalled()
    })
    it("records delivery failure and permits a retry", async () => {
      const email = prefix + "-failure@example.test"
      mail.mockRejectedValueOnce(new Error("Email unavailable"))
      await expect(
        customerOperation(
          { action: "invite_customer", email, reason: "Invite" },
          actor
        )
      ).rejects.toThrow()
      const logs = await database
        .select()
        .from(platformAdminAuditLog)
        .where(
          and(
            eq(platformAdminAuditLog.targetId, email),
            eq(platformAdminAuditLog.actorUserId, actor.userId)
          )
        )
      expect(JSON.parse(logs[0].afterState!)).toMatchObject({
        status: "failed",
      })
      await expect(
        customerOperation(
          { action: "invite_customer", email, reason: "Retry" },
          actor
        )
      ).resolves.toMatchObject({ status: "sent" })
    })
    it("reserves the last seat atomically, uses native invitations, and never creates a membership", async () => {
      const results = await Promise.allSettled(
        ["a", "b"].map((n) =>
          customerOperation(invite(prefix + n + "@example.test"), actor)
        )
      )
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
      const rows = await database
        .select()
        .from(invitation)
        .where(
          and(
            eq(invitation.organizationId, team),
            eq(invitation.status, "pending")
          )
        )
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ inviterId: owner, role: "editor" })
      expect(teamMail.mock.calls[0][1]).toContain(`/invite?token=${rows[0].id}`)
      expect(
        await database
          .select()
          .from(member)
          .where(eq(member.organizationId, team))
      ).toHaveLength(1)
      await expect(
        customerOperation(
          {
            action: "cancel_team_invitation",
            workspaceId: second,
            invitationId: rows[0].id,
            reason: "Wrong team",
          },
          actor
        )
      ).rejects.toThrow()
      await customerOperation(
        {
          action: "cancel_team_invitation",
          workspaceId: team,
          invitationId: rows[0].id,
          reason: "Revoke",
        },
        actor
      )
    })
    it("rolls back an invitation when email delivery fails", async () => {
      const email = prefix + "-mailfail@example.test"
      teamMail.mockRejectedValueOnce(new Error("No provider"))
      await expect(customerOperation(invite(email), actor)).rejects.toThrow()
      expect(
        await database
          .select()
          .from(invitation)
          .where(eq(invitation.email, email))
      ).toHaveLength(0)
    })
    it("suspends only the selected workspace and preserves billing", async () => {
      await changeWorkspaceAccess(
        {
          action: "change_workspace_access",
          workspaceType: "organization",
          workspaceId: team,
          access: "suspended",
          expectedRevision: 0,
          reason: "Abusive ingestion",
        },
        actor
      )
      await expect(
        customerOperation(invite(prefix + "-blocked@example.test"), actor)
      ).rejects.toThrow("Restore active team access")
      const [base] = await database
        .select()
        .from(workspaceSubscriptions)
        .where(eq(workspaceSubscriptions.workspaceId, team))
      expect(base).toMatchObject({
        accessState: "active",
        planKey: "pro",
        subscriptionStatus: "active",
      })
      await customerOperation(
        invite(prefix + "-allowed@example.test", second),
        actor
      )
      await changeWorkspaceAccess(
        {
          action: "change_workspace_access",
          workspaceType: "organization",
          workspaceId: team,
          access: "active",
          expectedRevision: 1,
          reason: "Resolved",
        },
        actor
      )
    })
    it("accepts a staff-created invitation through real Better Auth only for the verified recipient", async () => {
      const secret = "isolated-qa-secret-only-" + randomUUID()
      vi.stubEnv("BETTER_AUTH_SECRET", secret)
      vi.stubEnv("BETTER_AUTH_URL", "https://beta.example.test")
      await customerOperation(invite(other + "@example.test"), actor)
      const [pending] = await database
        .select()
        .from(invitation)
        .where(
          and(
            eq(invitation.organizationId, team),
            eq(invitation.email, other + "@example.test"),
            eq(invitation.status, "pending")
          )
        )
      const { auth } = await import("@/lib/auth")
      const headersFor = async (id: string) => {
        const token = randomUUID()
        await database
          .insert(session)
          .values({
            id: randomUUID(),
            token,
            userId: id,
            expiresAt: new Date(Date.now() + 3600_000),
            updatedAt: new Date(),
          })
        const signed =
          token +
          "." +
          createHmac("sha256", secret).update(token).digest("base64")
        return new Headers({
          cookie: `sparkfeed-app.session_token=${encodeURIComponent(signed)}`,
          origin: "https://beta.example.test",
        })
      }
      await expect(
        auth.api.acceptInvitation({
          headers: await headersFor(owner),
          body: { invitationId: pending.id },
        })
      ).rejects.toThrow()
      await database
        .update(user)
        .set({ emailVerified: false })
        .where(eq(user.id, other))
      await expect(
        auth.api.acceptInvitation({
          headers: await headersFor(other),
          body: { invitationId: pending.id },
        })
      ).rejects.toThrow()
      await database
        .update(user)
        .set({ emailVerified: true })
        .where(eq(user.id, other))
      await auth.api.acceptInvitation({
        headers: await headersFor(other),
        body: { invitationId: pending.id },
      })
      expect(
        await database
          .select()
          .from(member)
          .where(and(eq(member.organizationId, team), eq(member.userId, other)))
      ).toHaveLength(1)
      const [accepted] = await database
        .select()
        .from(invitation)
        .where(eq(invitation.id, pending.id))
      expect(accepted.status).toBe("accepted")
    })

    it("revokes exactly the chosen customer's session and never returns credentials", async () => {
      await database.insert(session).values([
        {
          id: prefix + "-session",
          token: "secret-" + prefix,
          userId: owner,
          expiresAt: new Date(Date.now() + 3600_000),
          updatedAt: new Date(),
          userAgent: "Firefox/130.0",
          ipAddress: "192.0.2.1",
        },
        {
          id: prefix + "-other-session",
          token: "other-secret-" + prefix,
          userId: other,
          expiresAt: new Date(Date.now() + 3600_000),
          updatedAt: new Date(),
        },
      ])
      const detail = await getPlatformUser(owner)
      expect(detail!.sessions[0]).toMatchObject({
        ipAddress: "192.0.2.1",
        userAgent: "Firefox/130.0",
      })
      expect(JSON.stringify(detail)).not.toContain("secret-")
      await expect(
        customerOperation(
          {
            action: "revoke_customer_session",
            userId: other,
            sessionId: prefix + "-session",
            reason: "Wrong user",
          },
          actor
        )
      ).rejects.toThrow()
      await customerOperation(
        {
          action: "revoke_customer_session",
          userId: owner,
          sessionId: prefix + "-session",
          reason: "Lost device",
        },
        actor
      )
      expect(
        await database
          .select()
          .from(session)
          .where(eq(session.id, prefix + "-other-session"))
      ).toHaveLength(1)
      expect(
        await database
          .select()
          .from(session)
          .where(eq(session.id, prefix + "-session"))
      ).toHaveLength(0)
    })
  }
)
