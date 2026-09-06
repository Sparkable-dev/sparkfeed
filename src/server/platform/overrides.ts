import { randomUUID } from "node:crypto"
import { and, eq, sql } from "drizzle-orm"
import { overrideInput, removeOverrideInput } from "./contracts"
import { PlatformRequestError } from "./assertion"
import { redactAuditValue } from "./audit-values"
import { db } from "@/db/index"
import {
  organization,
  platformAdminAuditLog,
  user,
  workspaceOverrides,
  workspaceSubscriptions,
} from "@/db/schema"
import { planSupportsWorkspace } from "@/server/entitlements/resolve"

export async function changeWorkspaceOverride(
  raw: unknown,
  actor: { userId: string; email: string },
  options: { auditAction?: string; initializeMissing?: boolean } = {}
) {
  const remove = (raw as { action?: string })?.action === "remove_override"
  const input = remove
    ? removeOverrideInput.parse(raw)
    : overrideInput.parse(raw)
  const now = new Date()
  const proposed = input.action === "set_override" ? input : null
  if (
    proposed?.planKey &&
    !planSupportsWorkspace(proposed.planKey, input.workspaceType)
  )
    throw new PlatformRequestError(
      400,
      "Plan does not match the workspace type."
    )
  if (
    input.workspaceType === "personal" &&
    proposed?.seatLimit &&
    proposed.seatLimit !== 1
  )
    throw new PlatformRequestError(400, "Personal workspaces have one owner.")
  if (
    proposed?.planKey === "pro" &&
    proposed.seatLimit &&
    proposed.seatLimit > 10
  )
    throw new PlatformRequestError(400, "Use Enterprise above 10 seats.")
  const expiresAt =
    proposed?.expiresAt === undefined
      ? new Date(now.getTime() + 30 * 86400000).toISOString()
      : proposed.expiresAt
  if (expiresAt && new Date(expiresAt) <= now)
    throw new PlatformRequestError(400, "Expiry must be in the future.")
  return db.transaction(async (tx) => {
    const target = input.workspaceType === "personal" ? user : organization
    const identityQuery = tx
      .select({ id: target.id })
      .from(target)
      .where(eq(target.id, input.workspaceId))
    if (typeof identityQuery.for === "function") identityQuery.for("update")
    const [identity] = await identityQuery.limit(1)

    if (!identity) throw new PlatformRequestError(404, "Workspace not found.")
    const subscriptionQuery = tx
      .select()
      .from(workspaceSubscriptions)
      .where(
        and(
          eq(workspaceSubscriptions.workspaceType, input.workspaceType),
          eq(workspaceSubscriptions.workspaceId, input.workspaceId)
        )
      )
    if (typeof subscriptionQuery.for === "function")
      subscriptionQuery.for("update")
    let [subscription] = await subscriptionQuery.limit(1)
    if (!subscription && options.initializeMissing) {
      const personal = input.workspaceType === "personal"
      ;[subscription] = await tx
        .insert(workspaceSubscriptions)
        .values({
          workspaceType: input.workspaceType,
          workspaceId: input.workspaceId,
          planKey: personal ? "free" : "pro",
          billingSource: personal ? "free" : "manual",
          subscriptionStatus: personal ? "free" : "canceled",
          accessState: personal ? "active" : "read_only",
          paidSeatQuantity: personal ? 1 : (proposed?.seatLimit ?? 1),
        })
        .returning()
    }
    if (!subscription)
      throw new PlatformRequestError(
        400,
        "Set up the billing record before adding an override."
      )
    if (proposed && input.workspaceType === "organization") {
      const plan = proposed.planKey ?? subscription.planKey
      const capacity =
        proposed.seatLimit ??
        (plan === "pro" ? subscription.paidSeatQuantity : null)
      if (plan === "pro" && capacity !== null && capacity > 10)
        throw new PlatformRequestError(
          400,
          "Pro supports up to 10 seats. Specify a valid seat limit or use Enterprise."
        )
      if (capacity !== null) {
        const counts = await tx.execute(
          sql`SELECT (SELECT count(*) FROM member WHERE organization_id=${input.workspaceId}) + (SELECT count(DISTINCT lower(i.email)) FROM invitation i WHERE i.organization_id=${input.workspaceId} AND i.status='pending' AND i.expires_at>now() AND NOT EXISTS(SELECT 1 FROM member m JOIN "user" u ON u.id=m.user_id WHERE m.organization_id=i.organization_id AND lower(u.email)=lower(i.email))) AS occupied`
        )
        if (Number(counts[0]?.occupied ?? 0) > capacity)
          throw new PlatformRequestError(
            400,
            "Remove members or pending invitations before reducing seat capacity."
          )
      }
    }
    const where = and(
      eq(workspaceOverrides.workspaceType, input.workspaceType),
      eq(workspaceOverrides.workspaceId, input.workspaceId)
    )
    const [before] = await tx
      .select()
      .from(workspaceOverrides)
      .where(where)
      .limit(1)
    if ((before?.revision ?? 0) !== input.expectedRevision)
      throw new PlatformRequestError(
        409,
        "This override changed. Refresh before saving."
      )
    // Keep a revoked record as a revision tombstone to prevent stale writes.
    const after = {
      workspaceType: input.workspaceType,
      workspaceId: input.workspaceId,
      planKey: proposed?.planKey ?? null,
      accessRestriction: proposed?.accessRestriction ?? null,
      seatLimit: proposed?.seatLimit ?? null,
      monthlyAiCredits: proposed?.monthlyAiCredits ?? null,
      sourceUnitLimit: proposed?.sourceUnitLimit ?? null,
      apiAccess: proposed?.apiAccess ?? null,
      mcpAccess: proposed?.mcpAccess ?? null,
      reason: input.reason,
      actorId: actor.userId,
      expiresAt: remove ? now.toISOString() : expiresAt,
      revision: input.expectedRevision + 1,
      createdAt: before?.createdAt ?? now.toISOString(),
      updatedAt: now.toISOString(),
    }
    if (before) {
      const changed = await tx
        .update(workspaceOverrides)
        .set(after)
        .where(
          and(where, eq(workspaceOverrides.revision, input.expectedRevision))
        )
        .returning()
      if (!changed.length)
        throw new PlatformRequestError(
          409,
          "This override changed. Refresh before saving."
        )
    } else {
      const changed = await tx
        .insert(workspaceOverrides)
        .values(after)
        .onConflictDoNothing()
        .returning()
      if (!changed.length)
        throw new PlatformRequestError(
          409,
          "An override was created. Refresh before saving."
        )
    }
    if (
      (remove || proposed?.planKey === "free" || proposed?.planKey === null) &&
      input.workspaceType === "personal" &&
      before?.planKey === "personal_plus"
    ) {
      await tx
        .update(workspaceSubscriptions)
        .set({
          paidCreditRetentionEndsAt: new Date(
            Math.min(
              now.getTime(),
              before.expiresAt ? Date.parse(before.expiresAt) : now.getTime()
            ) +
              30 * 86400000
          ).toISOString(),
        })
        .where(
          and(
            eq(workspaceSubscriptions.workspaceType, "personal"),
            eq(workspaceSubscriptions.workspaceId, input.workspaceId),
            eq(workspaceSubscriptions.planKey, "free")
          )
        )
    }
    await tx.insert(platformAdminAuditLog).values({
      id: randomUUID(),
      actorUserId: actor.userId,
      action: options.auditAction ?? input.action,
      targetType: "workspace",
      targetId: `${input.workspaceType}:${input.workspaceId}`,
      reason: input.reason,
      beforeState: JSON.stringify(redactAuditValue(before ?? null)),
      afterState: JSON.stringify(redactAuditValue(after)),
      createdAt: now.toISOString(),
    })
    return after
  })
}
