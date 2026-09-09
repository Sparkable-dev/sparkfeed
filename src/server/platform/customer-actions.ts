import { randomUUID } from "node:crypto"
import { and, desc, eq, gt, sql } from "drizzle-orm"
import { z } from "zod"
import { PlatformRequestError } from "./assertion"
import { failAdminAudit, startAdminAudit } from "./audit"
import { db } from "@/db/index"
import {
  invitation,
  member,
  organization,
  platformAdminAuditLog,
  session,
  user,
  workspaceSubscriptions,
} from "@/db/schema"
import { sendCustomerInviteEmail, sendInviteEmail } from "@/lib/email"
import {
  effectiveSubscription,
  readWorkspaceOverride,
} from "@/server/entitlements/effective"

type Actor = { userId: string; email: string }
const reason = z.string().trim().min(1).max(500)
const email = z.email().transform((v) => v.trim().toLowerCase())
const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("invite_customer"), email, reason }),
  z.object({
    action: z.literal("invite_team_member"),
    workspaceId: z.string().min(1),
    email,
    role: z.enum(["admin", "editor"]),
    reason,
  }),
  z.object({
    action: z.literal("cancel_team_invitation"),
    workspaceId: z.string().min(1),
    invitationId: z.string().min(1),
    reason,
  }),
  z.object({
    action: z.literal("revoke_customer_session"),
    userId: z.string().min(1),
    sessionId: z.string().min(1),
    reason,
  }),
])

function applicationUrl(path: string) {
  const base = new URL(
    process.env.APP_URL ||
      process.env.BETTER_AUTH_URL ||
      "http://localhost:3000"
  )
  if (process.env.NODE_ENV === "production" && base.protocol !== "https:")
    throw new PlatformRequestError(
      503,
      "Configure the public HTTPS application URL before sending invitations."
    )
  return new URL(path, base.origin)
}

export async function customerOperation(raw: unknown, actor: Actor) {
  const input = inputSchema.parse(raw)
  const targetId =
    "workspaceId" in input
      ? `organization:${input.workspaceId}`
      : "userId" in input
        ? input.userId
        : input.email
  const auditId = await startAdminAudit({
    actorUserId: actor.userId,
    action: input.action,
    targetType:
      "workspaceId" in input
        ? "workspace"
        : "userId" in input
          ? "user"
          : "customer_invitation",
    targetId,
    reason: input.reason,
    beforeState: { actorEmail: actor.email },
  })
  try {
    let result: Record<string, unknown>
    if (input.action === "invite_customer") {
      // Serialize outreach to the same address across staff and service replicas.
      result = await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${"customer-invite:" + input.email}))`
        )
        const [existing] = await tx
          .select({ id: user.id })
          .from(user)
          .where(sql`lower(${user.email})=${input.email}`)
          .limit(1)
        if (existing)
          throw new PlatformRequestError(
            409,
            "This customer already has an account. Open their user profile instead."
          )
        const [recent] = await tx
          .select({ id: platformAdminAuditLog.id })
          .from(platformAdminAuditLog)
          .where(
            and(
              eq(platformAdminAuditLog.action, "invite_customer"),
              eq(platformAdminAuditLog.targetId, input.email),
              gt(
                platformAdminAuditLog.createdAt,
                new Date(Date.now() - 60_000).toISOString()
              ),
              sql`${platformAdminAuditLog.afterState}::jsonb ->> 'status' = 'sent'`
            )
          )
          .limit(1)
        if (recent)
          throw new PlatformRequestError(
            429,
            "An invitation was just sent. Wait a minute before resending."
          )
        const url = applicationUrl("/signup")
        url.searchParams.set("email", input.email)
        await sendCustomerInviteEmail(
          input.email,
          url.href,
          process.env.SPARKFEED_ENVIRONMENT === "beta"
        )
        const sent = {
          status: "sent",
          email: input.email,
          actorEmail: actor.email,
        }
        await tx
          .update(platformAdminAuditLog)
          .set({ afterState: JSON.stringify(sent) })
          .where(eq(platformAdminAuditLog.id, auditId))
        return sent
      })
    } else if (input.action === "revoke_customer_session") {
      result = await db.transaction(async (tx) => {
        const removed = await tx
          .delete(session)
          .where(
            and(
              eq(session.id, input.sessionId),
              eq(session.userId, input.userId)
            )
          )
          .returning({ id: session.id })
        if (!removed.length)
          throw new PlatformRequestError(
            404,
            "Session no longer exists. Refresh this profile."
          )
        const after = {
          status: "completed",
          userId: input.userId,
          sessionId: input.sessionId,
          actorEmail: actor.email,
        }
        await tx
          .update(platformAdminAuditLog)
          .set({ afterState: JSON.stringify(after) })
          .where(eq(platformAdminAuditLog.id, auditId))
        return after
      })
    } else {
      result = await db.transaction(async (tx) => {
        const complete = async (value: Record<string, unknown>) => {
          const after = { ...value, actorEmail: actor.email }
          await tx
            .update(platformAdminAuditLog)
            .set({ afterState: JSON.stringify(after) })
            .where(eq(platformAdminAuditLog.id, auditId))
          return after
        }
        const [team] = await tx
          .select({ id: organization.id })
          .from(organization)
          .where(eq(organization.id, input.workspaceId))
          .for("update")
          .limit(1)
        if (!team) throw new PlatformRequestError(404, "Workspace not found.")
        if (input.action === "cancel_team_invitation") {
          const canceled = await tx
            .update(invitation)
            .set({ status: "canceled" })
            .where(
              and(
                eq(invitation.id, input.invitationId),
                eq(invitation.organizationId, input.workspaceId),
                eq(invitation.status, "pending")
              )
            )
            .returning({ email: invitation.email })
          if (!canceled.length)
            throw new PlatformRequestError(
              409,
              "Invitation is no longer pending."
            )
          return complete({ status: "completed", email: canceled[0].email })
        }
        const [base] = await tx
          .select()
          .from(workspaceSubscriptions)
          .where(
            and(
              eq(workspaceSubscriptions.workspaceType, "organization"),
              eq(workspaceSubscriptions.workspaceId, input.workspaceId)
            )
          )
          .limit(1)
        const effective =
          base &&
          effectiveSubscription(
            base,
            await readWorkspaceOverride(tx, {
              type: "organization",
              id: input.workspaceId,
            })
          )
        if (
          !effective ||
          effective.accessState !== "active" ||
          !["pro", "enterprise"].includes(effective.planKey)
        )
          throw new PlatformRequestError(
            403,
            "Restore active team access before inviting members."
          )
        const [owner] = await tx
          .select({ id: member.userId })
          .from(member)
          .where(
            and(
              eq(member.organizationId, input.workspaceId),
              eq(member.role, "owner")
            )
          )
          .limit(1)
        if (!owner)
          throw new PlatformRequestError(
            409,
            "The workspace needs an owner before sending invitations."
          )
        const [existingMember] = await tx
          .select({ id: member.id })
          .from(member)
          .innerJoin(user, eq(user.id, member.userId))
          .where(
            and(
              eq(member.organizationId, input.workspaceId),
              sql`lower(${user.email})=${input.email}`
            )
          )
          .limit(1)
        if (existingMember)
          throw new PlatformRequestError(
            409,
            "This person is already a member."
          )
        const [pending] = await tx
          .select()
          .from(invitation)
          .where(
            and(
              eq(invitation.organizationId, input.workspaceId),
              sql`lower(${invitation.email})=${input.email}`,
              eq(invitation.status, "pending")
            )
          )
          .orderBy(desc(invitation.createdAt))
          .limit(1)
        if (pending && pending.createdAt.getTime() > Date.now() - 60_000)
          throw new PlatformRequestError(
            429,
            "An invitation was just sent. Wait a minute before resending."
          )
        // A resend rotates the token. Better Auth's existing recipient verification and
        // acceptance path is reused; no customer session is impersonated by staff.
        if (pending)
          await tx
            .update(invitation)
            .set({ status: "canceled" })
            .where(
              and(
                eq(invitation.organizationId, input.workspaceId),
                sql`lower(${invitation.email})=${input.email}`,
                eq(invitation.status, "pending")
              )
            )
        const id = randomUUID(),
          expiresAt = new Date(Date.now() + 48 * 3600_000)
        await tx.insert(invitation).values({
          id,
          organizationId: input.workspaceId,
          email: input.email,
          role: input.role,
          inviterId: owner.id,
          expiresAt,
        })
        // Existing DB triggers serialize customer/staff writers and enforce seat capacity.
        const url = applicationUrl("/invite")
        url.searchParams.set("token", id)
        url.searchParams.set("email", input.email)
        await sendInviteEmail(input.email, url.href, true)
        return complete({
          status: "sent",
          email: input.email,
          role: input.role,
          expiresAt: expiresAt.toISOString(),
          onBehalfOf: owner.id,
        })
      })
    }
    return result
  } catch (error) {
    // Driver/provider errors may contain SQL parameters or invitation URLs.
    await failAdminAudit(
      auditId,
      error instanceof PlatformRequestError
        ? error
        : new Error(
            "Operation failed. Check the service's delivery or database health."
          )
    )
    let cause: unknown = error
    for (let i = 0; i < 5 && cause && typeof cause === "object"; i++) {
      if ("code" in cause && cause.code === "23514")
        throw new PlatformRequestError(
          409,
          "This workspace has no available seats."
        )
      cause = "cause" in cause ? cause.cause : null
    }
    if (error instanceof PlatformRequestError) throw error
    throw new PlatformRequestError(
      503,
      "The operation could not complete. Check email delivery and database availability before retrying."
    )
  }
}
