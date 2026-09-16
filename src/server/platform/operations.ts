import { randomUUID } from "node:crypto"
import { and, desc, eq, or, sql } from "drizzle-orm"
import { z } from "zod"
import {
  failAdminAudit,
  finishAdminAudit,
  requireAuditReason,
  startAdminAudit,
} from "./audit"
import type { PlatformActor } from "./access"
import { PlatformRequestError } from "@/server/platform/assertion"
import { db } from "@/db/index"
import {
  billingRequests,
  creditLedger,
  dodoWebhookInbox,
  invitation,
  member,
  organization,
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

const reason = z.string().trim().min(1).max(500)

export const operationalMutationSchema = z.discriminatedUnion("action", [
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

export type OperationalMutation = z.infer<typeof operationalMutationSchema>

async function teamRequest(requestId: string) {
  const [request] = await db
    .select()
    .from(billingRequests)
    .where(eq(billingRequests.id, requestId))
    .limit(1)
  if (!request) throw new PlatformRequestError(400, "Team request not found.")
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
      image: user.image,
      role: user.role,
      banned: user.banned,
      banReason: user.banReason,
      banExpires: user.banExpires,
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
      impersonatedBy: session.impersonatedBy,
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

async function lockTeamCapacity(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  workspaceId: string,
  capacity: number
) {
  const query = tx
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, workspaceId))
  if (typeof query.for === "function") query.for("update")
  const [target] = await query.limit(1)
  if (!target) throw new PlatformRequestError(404, "Workspace not found.")
  const people = await tx
    .select({ email: user.email })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, workspaceId))
  const invites = await tx
    .select({ email: invitation.email, expiresAt: invitation.expiresAt })
    .from(invitation)
    .where(
      and(
        eq(invitation.organizationId, workspaceId),
        eq(invitation.status, "pending")
      )
    )
  const accepted = new Set(people.map((p) => p.email.toLowerCase()))
  const reserved = new Set(
    invites
      .filter(
        (i) => i.expiresAt > new Date() && !accepted.has(i.email.toLowerCase())
      )
      .map((i) => i.email.toLowerCase())
  )
  if (people.length + reserved.size > capacity)
    throw new PlatformRequestError(
      400,
      "Remove members or pending invitations before reducing seat capacity."
    )
}

async function withAudit<T>(input: {
  actor: PlatformActor
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
    const config = readDodoBillingConfig()
    if (!config?.teamProducts) throw new PlatformRequestError(400, "Team billing configuration is unavailable.")
    const { reconcileTeam } = await import("@/server/billing/team-subscriptions")
    await reconcileTeam(workspaceId, dodoClient(), config)
    return getPlatformWorkspace(workspaceType, workspaceId)
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
    throw new PlatformRequestError(400, "Workspace has no Dodo subscription.")
  const client = dodoClient()
  const remote = await client.subscriptions.retrieve(local.dodoSubscriptionId)
  const config = readDodoBillingConfig()
  if (!config)
    throw new PlatformRequestError(
      400,
      "Dodo billing configuration is unavailable."
    )
  await reconcilePersonalSubscriptionFromDodo(remote, new Date(), config)
  return getPlatformWorkspace(workspaceType, workspaceId)
}

export async function executeOperationalMutation(
  actor: PlatformActor,
  raw: unknown
) {
  const mutation = operationalMutationSchema.parse(raw)
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
    if (!before) throw new PlatformRequestError(400, "Workspace not found.")
    if (before.billingSource !== "manual") {
      throw new PlatformRequestError(
        400,
        "Provider-managed subscriptions cannot be changed manually."
      )
    }
    if (mutation.planKey === "pro" && mutation.seatCapacity > 10) {
      throw new PlatformRequestError(
        400,
        "Pro supports up to 10 seats. Use Enterprise above 10."
      )
    }
    return withAudit({
      actor,
      action: mutation.action,
      targetType: "workspace",
      targetId: `organization:${mutation.workspaceId}`,
      reason: mutation.reason,
      beforeState: before,
      run: async () => {
        await db.transaction(async (tx) => {
          await lockTeamCapacity(
            tx,
            mutation.workspaceId,
            mutation.seatCapacity
          )
          await tx
            .update(workspaceSubscriptions)
            .set({
              planKey: mutation.planKey,
              subscriptionStatus: "active",
              accessState: "active",
              paidSeatQuantity: mutation.seatCapacity,
              overrideSeatLimit:
                mutation.planKey === "enterprise"
                  ? mutation.seatCapacity
                  : null,
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
        })
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
    if (!workspace) throw new PlatformRequestError(400, "Workspace not found.")
    if (
      mutation.workspaceType === "personal" &&
      mutation.beneficiaryUserId !== mutation.workspaceId
    ) {
      throw new PlatformRequestError(
        400,
        "Personal workspace credits belong to its owner."
      )
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
        throw new PlatformRequestError(
          400,
          "Credit beneficiary is not a workspace member."
        )
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
        await db.transaction(async (tx) => {
          if (typeof tx.execute === "function")
            await tx.execute(
              sql`select pg_advisory_xact_lock(hashtext(${`${mutation.workspaceType}:${mutation.workspaceId}:${mutation.beneficiaryUserId}`}))`
            )
          await tx.insert(creditLedger).values(entry)
        })
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
    if (!before) throw new PlatformRequestError(400, "Workspace not found.")
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
      throw new PlatformRequestError(400, "This request is already closed.")
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
        const changed = await db
          .update(billingRequests)
          .set({
            status,
            decisionNote,
            updatedAt: new Date().toISOString(),
          })
          .where(
            and(
              eq(billingRequests.id, mutation.requestId),
              or(
                eq(billingRequests.status, "pending"),
                eq(billingRequests.status, "in_review")
              )
            )
          )
          .returning({ id: billingRequests.id })
        if (!changed.length)
          throw new PlatformRequestError(409, "This request is already closed.")
        return teamRequest(mutation.requestId)
      },
      afterState: (result) => result,
    })
  }

  if (mutation.action === "approve_team_cancellation") {
    const before = await teamRequest(mutation.requestId)
    if (before.requestType !== "cancel_plan" || !before.workspaceId) {
      throw new PlatformRequestError(
        400,
        "This is not a valid team-plan cancellation request."
      )
    }
    if (before.status === "approved" || before.status === "declined") {
      throw new PlatformRequestError(400, "This request is already closed.")
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
          const requestQuery = tx
            .select()
            .from(billingRequests)
            .where(eq(billingRequests.id, mutation.requestId))
          if (typeof requestQuery.for === "function") requestQuery.for("update")
          const [fresh] = await requestQuery.limit(1)
          if (
            !fresh ||
            fresh.status === "approved" ||
            fresh.status === "declined"
          )
            throw new PlatformRequestError(
              409,
              "This request is already closed."
            )
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
          if (updated.length !== 1)
            throw new PlatformRequestError(400, "Workspace not found.")
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
      throw new PlatformRequestError(
        400,
        "Use the dedicated cancellation approval for cancel-plan requests."
      )
    }
    if (before.status === "declined")
      throw new PlatformRequestError(400, "This request was declined.")
    if (mutation.planKey === "pro" && mutation.seatCapacity > 10) {
      throw new PlatformRequestError(
        400,
        "Pro supports up to 10 seats. Use Enterprise above 10."
      )
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
          const requestQuery = tx
            .select()
            .from(billingRequests)
            .where(eq(billingRequests.id, mutation.requestId))
          if (typeof requestQuery.for === "function") requestQuery.for("update")
          const [fresh] = await requestQuery.limit(1)

          if (
            !fresh ||
            fresh.status === "approved" ||
            fresh.status === "declined"
          )
            throw new PlatformRequestError(
              409,
              "This request is already closed."
            )
          if (before.workspaceId) {
            await lockTeamCapacity(
              tx,
              before.workspaceId,
              mutation.seatCapacity
            )
            const [existing] = await tx
              .select()
              .from(workspaceSubscriptions)
              .where(
                and(
                  eq(workspaceSubscriptions.workspaceType, "organization"),
                  eq(workspaceSubscriptions.workspaceId, before.workspaceId)
                )
              )
              .limit(1)
            if (existing?.billingSource === "dodo")
              throw new PlatformRequestError(
                400,
                "Provider-managed subscriptions cannot be changed manually."
              )
          }
          if (before.requestType === "create_workspace") {
            if (!before.requesterUserId) {
              throw new PlatformRequestError(
                400,
                "The request has no requester account."
              )
            }
            const [requester] = await tx
              .select({ id: user.id })
              .from(user)
              .where(eq(user.id, before.requesterUserId))
              .limit(1)
            if (!requester)
              throw new PlatformRequestError(
                400,
                "Requester account not found."
              )
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
            throw new PlatformRequestError(
              400,
              "This plan request has no workspace."
            )
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
  if (!inbox)
    throw new PlatformRequestError(400, "Webhook inbox item not found.")
  if (inbox.processingStatus !== "failed")
    throw new PlatformRequestError(400, "Only failed webhooks can be replayed.")
  if (
    inbox.subjectType !== "personal" ||
    !inbox.subjectId ||
    !inbox.dodoSubscriptionId
  ) {
    throw new PlatformRequestError(
      400,
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
