import { randomUUID } from "node:crypto"
import { and, desc, eq, ilike, or } from "drizzle-orm"
import { z } from "zod"
import {
  failAdminAudit,
  finishAdminAudit,
  requireAuditReason,
  startAdminAudit,
} from "./audit"
import type { PlatformAdminActor } from "./access"
import { db } from "@/db/index"
import {
  billingRequests,
  creditLedger,
  dodoWebhookInbox,
  invitation,
  member,
  organization,
  platformAdminAuditLog,
  session,
  usageCounters,
  user,
  workspaceSubscriptions,
} from "@/db/schema"
import { dodoClient } from "@/server/billing/dodo-client"
import { readDodoBillingConfig } from "@/server/billing/dodo-config"
import { reconcilePersonalSubscriptionFromDodo } from "@/server/billing/personal-webhooks"

const workspaceRefSchema = z.object({
  workspaceType: z.enum(["personal", "organization"]),
  workspaceId: z.string().min(1),
})

const overridesSchema = z.object({
  seatLimit: z.number().int().positive().nullable(),
  monthlyAiCredits: z.number().int().nonnegative().nullable(),
  sourceUnitLimit: z.number().int().nonnegative().nullable(),
  apiAccess: z.boolean().nullable(),
  mcpAccess: z.boolean().nullable(),
})

const reason = z.string().trim().min(1).max(500)

export const adminMutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("ban_user"),
    targetUserId: z.string().min(1),
    reason,
  }),
  z.object({
    action: z.literal("unban_user"),
    targetUserId: z.string().min(1),
    reason,
  }),
  z.object({
    action: z.literal("revoke_session"),
    sessionId: z.string().min(1),
    reason,
  }),
  z.object({
    action: z.literal("send_password_reset"),
    targetUserId: z.string().min(1),
    reason,
  }),
  z.object({
    action: z.literal("suspend_workspace"),
    ...workspaceRefSchema.shape,
    reason,
  }),
  z.object({
    action: z.literal("reactivate_workspace"),
    ...workspaceRefSchema.shape,
    reason,
  }),
  z.object({
    action: z.literal("revoke_invitation"),
    invitationId: z.string().min(1),
    reason,
  }),
  z.object({
    action: z.literal("set_enterprise_entitlements"),
    ...workspaceRefSchema.shape,
    overrides: overridesSchema,
    reason,
  }),
  z.object({
    action: z.literal("set_workspace_plan"),
    workspaceType: z.literal("organization"),
    workspaceId: z.string().min(1),
    planKey: z.enum(["pro", "enterprise"]),
    seatCapacity: z.number().int().positive().max(500),
    reason,
  }),
  z.object({
    action: z.literal("adjust_credits"),
    ...workspaceRefSchema.shape,
    beneficiaryUserId: z.string().min(1),
    amount: z
      .number()
      .int()
      .refine((value) => value !== 0, "Amount cannot be zero."),
    creditBucket: z.enum(["free", "paid"]),
    reason,
  }),
  z.object({
    action: z.literal("replay_webhook"),
    webhookId: z.string().min(1),
    reason,
  }),
  z.object({
    action: z.literal("reconcile_subscription"),
    ...workspaceRefSchema.shape,
    reason,
  }),
  z.object({
    action: z.literal("mark_team_request_in_review"),
    requestId: z.string().min(1),
    reason,
  }),
  z.object({
    action: z.literal("decline_team_request"),
    requestId: z.string().min(1),
    decisionNote: z.string().trim().min(1).max(1000),
    reason,
  }),
  z.object({
    action: z.literal("approve_team_request"),
    requestId: z.string().min(1),
    planKey: z.enum(["pro", "enterprise"]),
    seatCapacity: z.number().int().positive().max(500),
    decisionNote: z.string().trim().max(1000),
    reason,
  }),
  z.object({
    action: z.literal("approve_team_cancellation"),
    requestId: z.string().min(1),
    decisionNote: z.string().trim().max(1000),
    reason,
  }),
])

export type AdminMutation = z.infer<typeof adminMutationSchema>

function safeJson(value: string | null): unknown {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return "[UNREADABLE]"
  }
}

export async function listPlatformUsers(query = "") {
  const term = query.trim()
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      role: user.role,
      banned: user.banned,
      banReason: user.banReason,
      banExpires: user.banExpires,
      twoFactorEnabled: user.twoFactorEnabled,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    })
    .from(user)
    .where(
      term
        ? or(ilike(user.email, `%${term}%`), ilike(user.name, `%${term}%`))
        : undefined
    )
    .orderBy(desc(user.updatedAt))
    .limit(50)

  return Promise.all(
    rows.map(async (row) => {
      const [activity] = await db
        .select({ lastActivityAt: session.updatedAt })
        .from(session)
        .where(eq(session.userId, row.id))
        .orderBy(desc(session.updatedAt))
        .limit(1)
      return { ...row, lastActivityAt: activity?.lastActivityAt ?? null }
    })
  )
}

export async function listTeamRequests(query = "") {
  const term = query.trim()
  return db
    .select({
      id: billingRequests.id,
      requestType: billingRequests.requestType,
      requesterUserId: billingRequests.requesterUserId,
      name: billingRequests.name,
      email: billingRequests.email,
      workspaceName: billingRequests.workspaceName,
      expectedSeats: billingRequests.expectedSeats,
      requestedPlan: billingRequests.requestedPlan,
      workspaceId: billingRequests.workspaceId,
      status: billingRequests.status,
      message: billingRequests.message,
      decisionNote: billingRequests.decisionNote,
      createdAt: billingRequests.createdAt,
      updatedAt: billingRequests.updatedAt,
    })
    .from(billingRequests)
    .where(
      term
        ? or(
            ilike(billingRequests.email, `%${term}%`),
            ilike(billingRequests.company, `%${term}%`),
            ilike(billingRequests.workspaceName, `%${term}%`)
          )
        : undefined
    )
    .orderBy(desc(billingRequests.createdAt))
    .limit(100)
}

async function teamRequest(requestId: string) {
  const [request] = await db
    .select()
    .from(billingRequests)
    .where(eq(billingRequests.id, requestId))
    .limit(1)
  if (!request) throw new Error("Team request not found.")
  return request
}

async function availableOrganizationSlug(name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "workspace"
  let slug = base
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const [existing] = await db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.slug, slug))
      .limit(1)
    if (!existing) return slug
    slug = `${base}-${attempt + 2}`
  }
  return `${base}-${randomUUID().slice(0, 8)}`
}

export async function getPlatformUser(userId: string) {
  const [account] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      role: user.role,
      banned: user.banned,
      banReason: user.banReason,
      banExpires: user.banExpires,
      twoFactorEnabled: user.twoFactorEnabled,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      dodoCustomerId: user.dodoCustomerId,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  if (!account) return null

  const sessions = await db
    .select({
      id: session.id,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      expiresAt: session.expiresAt,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      activeOrganizationId: session.activeOrganizationId,
    })
    .from(session)
    .where(eq(session.userId, userId))
    .orderBy(desc(session.updatedAt))

  const memberships = await db
    .select({
      memberId: member.id,
      role: member.role,
      createdAt: member.createdAt,
      organizationId: organization.id,
      organizationName: organization.name,
      organizationSlug: organization.slug,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, userId))

  return { account, sessions, memberships }
}

async function workspaceLabel(
  workspaceType: "personal" | "organization",
  workspaceId: string
) {
  if (workspaceType === "personal") {
    const [owner] = await db
      .select({ name: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, workspaceId))
      .limit(1)
    return {
      name: owner?.name ? `${owner.name}'s workspace` : "Personal workspace",
      owner: owner ?? null,
    }
  }
  const [org] = await db
    .select({ name: organization.name, slug: organization.slug })
    .from(organization)
    .where(eq(organization.id, workspaceId))
    .limit(1)
  const [owner] = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(
      and(eq(member.organizationId, workspaceId), eq(member.role, "owner"))
    )
    .limit(1)
  return {
    name: org?.name ?? "Unknown organization",
    slug: org?.slug,
    owner: owner ?? null,
  }
}

function seatCapacity(row: typeof workspaceSubscriptions.$inferSelect) {
  if (row.overrideSeatLimit !== null) return row.overrideSeatLimit
  if (row.workspaceType === "personal") return 1
  if (row.planKey === "pro") return row.paidSeatQuantity
  return null
}

export async function listPlatformWorkspaces(query = "") {
  const rows = await db
    .select()
    .from(workspaceSubscriptions)
    .orderBy(desc(workspaceSubscriptions.updatedAt))
    .limit(100)
  const enriched = await Promise.all(
    rows.map(async (row) => ({
      ...row,
      seatCapacity: seatCapacity(row),
      ...(await workspaceLabel(row.workspaceType, row.workspaceId)),
    }))
  )
  const term = query.trim().toLowerCase()
  if (!term) return enriched.slice(0, 50)
  return enriched
    .filter((row) =>
      [
        row.workspaceId,
        row.name,
        row.owner?.name,
        row.owner?.email,
        row.dodoCustomerId,
        row.dodoSubscriptionId,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    )
    .slice(0, 50)
}

export async function getPlatformWorkspace(
  workspaceType: "personal" | "organization",
  workspaceId: string
) {
  const [subscription] = await db
    .select()
    .from(workspaceSubscriptions)
    .where(
      and(
        eq(workspaceSubscriptions.workspaceType, workspaceType),
        eq(workspaceSubscriptions.workspaceId, workspaceId)
      )
    )
    .limit(1)
  if (!subscription) return null

  const label = await workspaceLabel(workspaceType, workspaceId)
  const members =
    workspaceType === "organization"
      ? await db
          .select({
            memberId: member.id,
            userId: user.id,
            name: user.name,
            email: user.email,
            role: member.role,
            createdAt: member.createdAt,
          })
          .from(member)
          .innerJoin(user, eq(member.userId, user.id))
          .where(eq(member.organizationId, workspaceId))
      : []
  const invitations =
    workspaceType === "organization"
      ? await db
          .select({
            id: invitation.id,
            email: invitation.email,
            role: invitation.role,
            status: invitation.status,
            expiresAt: invitation.expiresAt,
            createdAt: invitation.createdAt,
          })
          .from(invitation)
          .where(eq(invitation.organizationId, workspaceId))
          .orderBy(desc(invitation.createdAt))
      : []
  const usage = await db
    .select()
    .from(usageCounters)
    .where(
      and(
        eq(usageCounters.workspaceType, workspaceType),
        eq(usageCounters.workspaceId, workspaceId)
      )
    )
    .orderBy(desc(usageCounters.periodStart))
    .limit(100)

  return {
    subscription: { ...subscription, seatCapacity: seatCapacity(subscription) },
    ...label,
    members,
    invitations,
    usage,
  }
}

export async function listWebhookFailures() {
  return db
    .select({
      webhookId: dodoWebhookInbox.webhookId,
      eventType: dodoWebhookInbox.eventType,
      eventTime: dodoWebhookInbox.eventTime,
      subjectType: dodoWebhookInbox.subjectType,
      subjectId: dodoWebhookInbox.subjectId,
      dodoSubscriptionId: dodoWebhookInbox.dodoSubscriptionId,
      processingStatus: dodoWebhookInbox.processingStatus,
      attemptCount: dodoWebhookInbox.attemptCount,
      lastError: dodoWebhookInbox.lastError,
      receivedAt: dodoWebhookInbox.receivedAt,
      processedAt: dodoWebhookInbox.processedAt,
    })
    .from(dodoWebhookInbox)
    .where(eq(dodoWebhookInbox.processingStatus, "failed"))
    .orderBy(desc(dodoWebhookInbox.eventTime))
    .limit(100)
}

export async function listAdminAudit() {
  const rows = await db
    .select()
    .from(platformAdminAuditLog)
    .orderBy(desc(platformAdminAuditLog.createdAt))
    .limit(200)
  return rows.map((row) => ({
    ...row,
    beforeState: safeJson(row.beforeState),
    afterState: safeJson(row.afterState),
  }))
}

async function readUserState(userId: string) {
  const [row] = await db
    .select({
      id: user.id,
      banned: user.banned,
      banReason: user.banReason,
      banExpires: user.banExpires,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  if (!row) throw new Error("User not found.")
  return row
}

async function withAudit<T>(input: {
  actor: PlatformAdminActor
  action: string
  targetType: string
  targetId: string
  reason: string
  beforeState?: unknown
  run: () => Promise<T>
  afterState: (result: T) => unknown | Promise<unknown>
}): Promise<T> {
  const auditId = await startAdminAudit({
    actorUserId: input.actor.userId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    reason: requireAuditReason(input.reason),
    beforeState: input.beforeState,
  })
  try {
    const result = await input.run()
    await finishAdminAudit(auditId, await input.afterState(result))
    return result
  } catch (error) {
    await failAdminAudit(auditId, error)
    throw error
  }
}

async function reconcileSubscription(
  workspaceType: "personal" | "organization",
  workspaceId: string
) {
  if (workspaceType !== "personal") {
    throw new Error(
      "Organization subscription reconciliation starts in Phase 5."
    )
  }
  const [local] = await db
    .select()
    .from(workspaceSubscriptions)
    .where(
      and(
        eq(workspaceSubscriptions.workspaceType, workspaceType),
        eq(workspaceSubscriptions.workspaceId, workspaceId)
      )
    )
    .limit(1)
  if (!local?.dodoSubscriptionId)
    throw new Error("Workspace has no Dodo subscription.")
  const client = dodoClient()
  const remote = await client.subscriptions.retrieve(local.dodoSubscriptionId)
  const config = readDodoBillingConfig()
  if (!config) throw new Error("Dodo billing configuration is unavailable.")
  await reconcilePersonalSubscriptionFromDodo(remote, new Date(), config)
  return getPlatformWorkspace(workspaceType, workspaceId)
}

export async function executeAdminMutation(
  request: Request,
  actor: PlatformAdminActor,
  raw: unknown
) {
  const mutation = adminMutationSchema.parse(raw)
  const { auth } = await import("@/lib/auth")

  if (mutation.action === "ban_user" || mutation.action === "unban_user") {
    if (
      mutation.action === "ban_user" &&
      mutation.targetUserId === actor.userId
    ) {
      throw new Error("The active platform administrator cannot self-ban.")
    }
    const before = await readUserState(mutation.targetUserId)
    return withAudit({
      actor,
      action: mutation.action,
      targetType: "user",
      targetId: mutation.targetUserId,
      reason: mutation.reason,
      beforeState: before,
      run: async () => {
        if (mutation.action === "ban_user") {
          await auth.api.banUser({
            headers: request.headers,
            body: { userId: mutation.targetUserId, banReason: mutation.reason },
          })
        } else {
          await auth.api.unbanUser({
            headers: request.headers,
            body: { userId: mutation.targetUserId },
          })
        }
        return readUserState(mutation.targetUserId)
      },
      afterState: (result) => result,
    })
  }

  if (mutation.action === "revoke_session") {
    const [target] = await db
      .select({
        id: session.id,
        token: session.token,
        userId: session.userId,
        expiresAt: session.expiresAt,
      })
      .from(session)
      .where(eq(session.id, mutation.sessionId))
      .limit(1)
    if (!target) throw new Error("Session not found.")
    return withAudit({
      actor,
      action: mutation.action,
      targetType: "session",
      targetId: target.id,
      reason: mutation.reason,
      beforeState: {
        id: target.id,
        userId: target.userId,
        expiresAt: target.expiresAt,
      },
      run: async () =>
        auth.api.revokeUserSession({
          headers: request.headers,
          body: { sessionToken: target.token },
        }),
      afterState: () => ({ revoked: true }),
    })
  }

  if (mutation.action === "send_password_reset") {
    const [target] = await db
      .select({ id: user.id, email: user.email, role: user.role })
      .from(user)
      .where(eq(user.id, mutation.targetUserId))
      .limit(1)
    if (!target) throw new Error("User not found.")
    const isAdmin = target.role.split(",").includes("admin")
    const origin = isAdmin
      ? process.env.SPARKFEED_ADMIN_ORIGIN || "https://admin.sparkfeed.dev"
      : process.env.SPARKFEED_APP_ORIGIN || "https://app.sparkfeed.dev"
    return withAudit({
      actor,
      action: mutation.action,
      targetType: "user",
      targetId: target.id,
      reason: mutation.reason,
      beforeState: { email: target.email },
      run: async () =>
        auth.api.requestPasswordReset({
          body: { email: target.email, redirectTo: `${origin}/reset-password` },
        }),
      afterState: () => ({ delivered: true }),
    })
  }

  if (
    mutation.action === "suspend_workspace" ||
    mutation.action === "reactivate_workspace"
  ) {
    const [before] = await db
      .select()
      .from(workspaceSubscriptions)
      .where(
        and(
          eq(workspaceSubscriptions.workspaceType, mutation.workspaceType),
          eq(workspaceSubscriptions.workspaceId, mutation.workspaceId)
        )
      )
      .limit(1)
    if (!before) throw new Error("Workspace not found.")
    const accessState =
      mutation.action === "suspend_workspace" ? "suspended" : "active"
    return withAudit({
      actor,
      action: mutation.action,
      targetType: "workspace",
      targetId: `${mutation.workspaceType}:${mutation.workspaceId}`,
      reason: mutation.reason,
      beforeState: before,
      run: async () => {
        await db
          .update(workspaceSubscriptions)
          .set({ accessState, updatedAt: new Date().toISOString() })
          .where(
            and(
              eq(workspaceSubscriptions.workspaceType, mutation.workspaceType),
              eq(workspaceSubscriptions.workspaceId, mutation.workspaceId)
            )
          )
        return getPlatformWorkspace(
          mutation.workspaceType,
          mutation.workspaceId
        )
      },
      afterState: (result) => result?.subscription,
    })
  }

  if (mutation.action === "revoke_invitation") {
    const [before] = await db
      .select()
      .from(invitation)
      .where(eq(invitation.id, mutation.invitationId))
      .limit(1)
    if (!before) throw new Error("Invitation not found.")
    return withAudit({
      actor,
      action: mutation.action,
      targetType: "invitation",
      targetId: mutation.invitationId,
      reason: mutation.reason,
      beforeState: before,
      run: async () => {
        await db
          .update(invitation)
          .set({ status: "canceled" })
          .where(eq(invitation.id, mutation.invitationId))
        return { ...before, status: "canceled" }
      },
      afterState: (result) => result,
    })
  }

  if (mutation.action === "set_enterprise_entitlements") {
    const [before] = await db
      .select()
      .from(workspaceSubscriptions)
      .where(
        and(
          eq(workspaceSubscriptions.workspaceType, mutation.workspaceType),
          eq(workspaceSubscriptions.workspaceId, mutation.workspaceId)
        )
      )
      .limit(1)
    if (!before) throw new Error("Workspace not found.")
    if (before.planKey !== "enterprise") {
      throw new Error(
        "Typed manual overrides are restricted to Enterprise workspaces."
      )
    }
    return withAudit({
      actor,
      action: mutation.action,
      targetType: "workspace",
      targetId: `${mutation.workspaceType}:${mutation.workspaceId}`,
      reason: mutation.reason,
      beforeState: before,
      run: async () => {
        await db
          .update(workspaceSubscriptions)
          .set({
            overrideSeatLimit: mutation.overrides.seatLimit,
            overrideMonthlyAiCredits: mutation.overrides.monthlyAiCredits,
            overrideSourceUnitLimit: mutation.overrides.sourceUnitLimit,
            overrideApiAccess: mutation.overrides.apiAccess,
            overrideMcpAccess: mutation.overrides.mcpAccess,
            updatedAt: new Date().toISOString(),
          })
          .where(
            and(
              eq(workspaceSubscriptions.workspaceType, mutation.workspaceType),
              eq(workspaceSubscriptions.workspaceId, mutation.workspaceId)
            )
          )
        return getPlatformWorkspace(
          mutation.workspaceType,
          mutation.workspaceId
        )
      },
      afterState: (result) => result?.subscription,
    })
  }

  if (mutation.action === "set_workspace_plan") {
    const [before] = await db
      .select()
      .from(workspaceSubscriptions)
      .where(
        and(
          eq(workspaceSubscriptions.workspaceType, "organization"),
          eq(workspaceSubscriptions.workspaceId, mutation.workspaceId)
        )
      )
      .limit(1)
    if (!before) throw new Error("Workspace not found.")
    if (before.billingSource !== "manual") {
      throw new Error(
        "Provider-managed subscriptions cannot be changed manually."
      )
    }
    if (mutation.planKey === "pro" && mutation.seatCapacity > 10) {
      throw new Error("Pro supports up to 10 seats. Use Enterprise above 10.")
    }
    return withAudit({
      actor,
      action: mutation.action,
      targetType: "workspace",
      targetId: `organization:${mutation.workspaceId}`,
      reason: mutation.reason,
      beforeState: before,
      run: async () => {
        await db
          .update(workspaceSubscriptions)
          .set({
            planKey: mutation.planKey,
            subscriptionStatus: "active",
            accessState: "active",
            paidSeatQuantity: mutation.seatCapacity,
            overrideSeatLimit:
              mutation.planKey === "enterprise" ? mutation.seatCapacity : null,
            overrideMonthlyAiCredits:
              mutation.planKey === "pro"
                ? null
                : before.overrideMonthlyAiCredits,
            overrideSourceUnitLimit:
              mutation.planKey === "pro"
                ? null
                : before.overrideSourceUnitLimit,
            overrideApiAccess:
              mutation.planKey === "pro" ? null : before.overrideApiAccess,
            overrideMcpAccess:
              mutation.planKey === "pro" ? null : before.overrideMcpAccess,
            updatedAt: new Date().toISOString(),
          })
          .where(
            and(
              eq(workspaceSubscriptions.workspaceType, "organization"),
              eq(workspaceSubscriptions.workspaceId, mutation.workspaceId)
            )
          )
        return getPlatformWorkspace("organization", mutation.workspaceId)
      },
      afterState: (result) => result?.subscription,
    })
  }

  if (mutation.action === "adjust_credits") {
    const workspace = await getPlatformWorkspace(
      mutation.workspaceType,
      mutation.workspaceId
    )
    if (!workspace) throw new Error("Workspace not found.")
    if (
      mutation.workspaceType === "personal" &&
      mutation.beneficiaryUserId !== mutation.workspaceId
    ) {
      throw new Error("Personal workspace credits belong to its owner.")
    }
    if (mutation.workspaceType === "organization") {
      const [accepted] = await db
        .select({ id: member.id })
        .from(member)
        .where(
          and(
            eq(member.organizationId, mutation.workspaceId),
            eq(member.userId, mutation.beneficiaryUserId)
          )
        )
        .limit(1)
      if (!accepted)
        throw new Error("Credit beneficiary is not a workspace member.")
    }
    const entry = {
      id: randomUUID(),
      workspaceType: mutation.workspaceType,
      workspaceId: mutation.workspaceId,
      beneficiaryUserId: mutation.beneficiaryUserId,
      creditBucket: mutation.creditBucket,
      amount: mutation.amount,
      entryType: "adjustment" as const,
      reason: mutation.reason,
      actorUserId: actor.userId,
      idempotencyKey: `admin-adjustment:${randomUUID()}`,
      createdAt: new Date().toISOString(),
    }
    return withAudit({
      actor,
      action: mutation.action,
      targetType: "workspace_credit",
      targetId: `${mutation.workspaceType}:${mutation.workspaceId}:${mutation.beneficiaryUserId}`,
      reason: mutation.reason,
      beforeState: { planKey: workspace.subscription.planKey },
      run: async () => {
        await db.insert(creditLedger).values(entry)
        return entry
      },
      afterState: (result) => result,
    })
  }

  if (mutation.action === "reconcile_subscription") {
    const before = await getPlatformWorkspace(
      mutation.workspaceType,
      mutation.workspaceId
    )
    if (!before) throw new Error("Workspace not found.")
    return withAudit({
      actor,
      action: mutation.action,
      targetType: "subscription",
      targetId: `${mutation.workspaceType}:${mutation.workspaceId}`,
      reason: mutation.reason,
      beforeState: before.subscription,
      run: () =>
        reconcileSubscription(mutation.workspaceType, mutation.workspaceId),
      afterState: (result) => result?.subscription,
    })
  }

  if (
    mutation.action === "mark_team_request_in_review" ||
    mutation.action === "decline_team_request"
  ) {
    const before = await teamRequest(mutation.requestId)
    if (before.status === "approved" || before.status === "declined") {
      throw new Error("This request is already closed.")
    }
    const status =
      mutation.action === "mark_team_request_in_review"
        ? "in_review"
        : "declined"
    const decisionNote =
      mutation.action === "decline_team_request"
        ? mutation.decisionNote
        : before.decisionNote
    return withAudit({
      actor,
      action: mutation.action,
      targetType: "team_request",
      targetId: mutation.requestId,
      reason: mutation.reason,
      beforeState: before,
      run: async () => {
        await db
          .update(billingRequests)
          .set({
            status,
            decisionNote,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(billingRequests.id, mutation.requestId))
        return teamRequest(mutation.requestId)
      },
      afterState: (result) => result,
    })
  }

  if (mutation.action === "approve_team_cancellation") {
    const before = await teamRequest(mutation.requestId)
    if (before.requestType !== "cancel_plan" || !before.workspaceId) {
      throw new Error("This is not a valid team-plan cancellation request.")
    }
    if (before.status === "approved" || before.status === "declined") {
      throw new Error("This request is already closed.")
    }
    const now = new Date().toISOString()
    return withAudit({
      actor,
      action: mutation.action,
      targetType: "team_request",
      targetId: mutation.requestId,
      reason: mutation.reason,
      beforeState: before,
      run: async () => {
        await db.transaction(async (tx) => {
          const updated = await tx
            .update(workspaceSubscriptions)
            .set({
              subscriptionStatus: "canceled",
              accessState: "read_only",
              updatedAt: now,
            })
            .where(
              and(
                eq(workspaceSubscriptions.workspaceType, "organization"),
                eq(workspaceSubscriptions.workspaceId, before.workspaceId!)
              )
            )
            .returning({ workspaceId: workspaceSubscriptions.workspaceId })
          if (updated.length !== 1) throw new Error("Workspace not found.")
          await tx
            .update(billingRequests)
            .set({
              status: "approved",
              decisionNote: mutation.decisionNote || null,
              updatedAt: now,
            })
            .where(eq(billingRequests.id, mutation.requestId))
        })
        return teamRequest(mutation.requestId)
      },
      afterState: (result) => result,
    })
  }

  if (mutation.action === "approve_team_request") {
    const before = await teamRequest(mutation.requestId)
    if (before.requestType === "cancel_plan") {
      throw new Error(
        "Use the dedicated cancellation approval for cancel-plan requests."
      )
    }
    if (before.status === "declined")
      throw new Error("This request was declined.")
    if (mutation.planKey === "pro" && mutation.seatCapacity > 10) {
      throw new Error("Pro supports up to 10 seats. Use Enterprise above 10.")
    }
    const now = new Date().toISOString()
    const newWorkspaceId = before.workspaceId || randomUUID()
    const workspaceName = before.workspaceName || before.company
    const slug =
      before.requestType === "create_workspace" && !before.workspaceId
        ? await availableOrganizationSlug(workspaceName)
        : null
    return withAudit({
      actor,
      action: mutation.action,
      targetType: "team_request",
      targetId: mutation.requestId,
      reason: mutation.reason,
      beforeState: before,
      run: async () => {
        await db.transaction(async (tx) => {
          if (before.requestType === "create_workspace") {
            if (!before.requesterUserId) {
              throw new Error("The request has no requester account.")
            }
            const [requester] = await tx
              .select({ id: user.id })
              .from(user)
              .where(eq(user.id, before.requesterUserId))
              .limit(1)
            if (!requester) throw new Error("Requester account not found.")
            if (!before.workspaceId) {
              await tx.insert(organization).values({
                id: newWorkspaceId,
                name: workspaceName,
                slug: slug!,
                createdAt: new Date(),
              })
              await tx.insert(member).values({
                id: randomUUID(),
                organizationId: newWorkspaceId,
                userId: requester.id,
                role: "owner",
                createdAt: new Date(),
              })
            }
          } else if (!before.workspaceId) {
            throw new Error("This plan request has no workspace.")
          }

          await tx
            .insert(workspaceSubscriptions)
            .values({
              workspaceType: "organization",
              workspaceId: newWorkspaceId,
              planKey: mutation.planKey,
              billingSource: "manual",
              subscriptionStatus: "active",
              accessState: "active",
              paidSeatQuantity: mutation.seatCapacity,
              overrideSeatLimit:
                mutation.planKey === "enterprise"
                  ? mutation.seatCapacity
                  : null,
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: [
                workspaceSubscriptions.workspaceType,
                workspaceSubscriptions.workspaceId,
              ],
              set: {
                planKey: mutation.planKey,
                billingSource: "manual",
                subscriptionStatus: "active",
                accessState: "active",
                paidSeatQuantity: mutation.seatCapacity,
                overrideSeatLimit:
                  mutation.planKey === "enterprise"
                    ? mutation.seatCapacity
                    : null,
                updatedAt: now,
              },
            })

          await tx
            .update(billingRequests)
            .set({
              status: "approved",
              workspaceId: newWorkspaceId,
              requestedPlan: mutation.planKey,
              expectedSeats: mutation.seatCapacity,
              decisionNote: mutation.decisionNote || null,
              updatedAt: now,
            })
            .where(eq(billingRequests.id, mutation.requestId))
        })
        return teamRequest(mutation.requestId)
      },
      afterState: (result) => result,
    })
  }

  const [inbox] = await db
    .select()
    .from(dodoWebhookInbox)
    .where(eq(dodoWebhookInbox.webhookId, mutation.webhookId))
    .limit(1)
  if (!inbox) throw new Error("Webhook inbox item not found.")
  if (inbox.processingStatus !== "failed")
    throw new Error("Only failed webhooks can be replayed.")
  if (
    inbox.subjectType !== "personal" ||
    !inbox.subjectId ||
    !inbox.dodoSubscriptionId
  ) {
    throw new Error(
      "This webhook has no replay-safe Personal+ subscription reference."
    )
  }
  return withAudit({
    actor,
    action: mutation.action,
    targetType: "webhook",
    targetId: mutation.webhookId,
    reason: mutation.reason,
    beforeState: inbox,
    run: async () => {
      await db
        .update(dodoWebhookInbox)
        .set({
          processingStatus: "processing",
          attemptCount: inbox.attemptCount + 1,
          processingStartedAt: new Date().toISOString(),
          lastError: null,
        })
        .where(eq(dodoWebhookInbox.webhookId, mutation.webhookId))
      try {
        await reconcileSubscription("personal", inbox.subjectId!)
        const after = {
          processingStatus: "processed" as const,
          processedAt: new Date().toISOString(),
          lastError: null,
        }
        await db
          .update(dodoWebhookInbox)
          .set(after)
          .where(eq(dodoWebhookInbox.webhookId, mutation.webhookId))
        return after
      } catch (error) {
        await db
          .update(dodoWebhookInbox)
          .set({
            processingStatus: "failed",
            lastError: (error instanceof Error
              ? error.message
              : "Unknown error"
            ).slice(0, 500),
          })
          .where(eq(dodoWebhookInbox.webhookId, mutation.webhookId))
        throw error
      }
    },
    afterState: (result) => result,
  })
}
