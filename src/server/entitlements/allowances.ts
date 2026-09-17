import { randomUUID } from "node:crypto"
import { and, eq, gte, lt, sql } from "drizzle-orm"
import { readEffectiveSubscription } from "./effective"
import { sparkAiPlanPolicy } from "./plan-policy"
import type { WorkspaceRef } from "./types"
import { db } from "@/db/index"
import { creditLedger, member, workspaceCreditSchedules } from "@/db/schema"

/** Clamp anniversaries to the last day, without Jan-31 -> March drift. */
export function allowancePeriod(anchor: Date, at: Date) {
  const anniversary = (offset: number) => {
    const d = new Date(anchor)
    d.setUTCDate(1)
    d.setUTCMonth(d.getUTCMonth() + offset)
    const last = new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)
    ).getUTCDate()
    d.setUTCDate(Math.min(anchor.getUTCDate(), last))
    return d
  }
  let months = Math.max(
    0,
    (at.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
      at.getUTCMonth() -
      anchor.getUTCMonth()
  )
  if (anniversary(months) > at && months > 0) months--
  return { start: anniversary(months), end: anniversary(months + 1) }
}

/** The same ledger target is used by webhook, lazy refresh and scheduled runs. */
export async function grantWorkspaceAllowance(
  workspace: WorkspaceRef,
  userId: string,
  at = new Date()
) {
  return db.transaction(async (tx) => {
    // SQLite fixtures are single-writer; production serializes each credit account.
    if (typeof tx.execute === "function")
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`${workspace.type}:${workspace.id}:${userId}`}))`
      )
    const row = await readEffectiveSubscription(tx, workspace, at, true)
    if (!row || row.accessState !== "active" || row.planKey === "free") return 0
    let joinedAt: Date | null = null
    if (workspace.type === "organization") {
      const [membership] = await tx
        .select({ createdAt: member.createdAt })
        .from(member)
        .where(
          and(
            eq(member.organizationId, workspace.id),
            eq(member.userId, userId)
          )
        )
        .limit(1)
      if (!membership) return 0
      joinedAt = membership.createdAt
    } else if (workspace.id !== userId) return 0
    const policy = sparkAiPlanPolicy(row.planKey)
    const monthly = row.overrideMonthlyAiCredits ?? policy.monthlyCredits ?? 0
    if (monthly <= 0) return 0
    const scheduleWhere = and(
      eq(workspaceCreditSchedules.workspaceType, workspace.type),
      eq(workspaceCreditSchedules.workspaceId, workspace.id),
      eq(workspaceCreditSchedules.userId, userId)
    )
    let [schedule] = await tx
      .select()
      .from(workspaceCreditSchedules)
      .where(scheduleWhere)
      .limit(1)
    if (!schedule) {
      const [history] = await tx
        .select({ first: sql<string | null>`min(${creditLedger.grantPeriod})` })
        .from(creditLedger)
        .where(
          and(
            eq(creditLedger.workspaceType, workspace.type),
            eq(creditLedger.workspaceId, workspace.id),
            eq(creditLedger.beneficiaryUserId, userId),
            eq(creditLedger.creditBucket, "paid"),
            eq(creditLedger.entryType, "grant")
          )
        )
      const candidate =
        history?.first ?? row.currentPeriodStart ?? row.createdAt
      const anchorAt = Number.isFinite(Date.parse(candidate))
        ? new Date(candidate).toISOString()
        : at.toISOString()
      ;[schedule] = await tx
        .insert(workspaceCreditSchedules)
        .values({
          workspaceType: workspace.type,
          workspaceId: workspace.id,
          userId,
          anchorAt,
        })
        .returning()
    }
    const { start, end } = allowancePeriod(new Date(schedule.anchorAt), at)
    if (start > at) return 0
    const target =
      joinedAt && joinedAt > start
        ? Math.floor(
            monthly *
              Math.max(
                0,
                (end.getTime() - joinedAt.getTime()) /
                  (end.getTime() - start.getTime())
              )
          )
        : monthly
    const owner = and(
      eq(creditLedger.workspaceType, workspace.type),
      eq(creditLedger.workspaceId, workspace.id),
      eq(creditLedger.beneficiaryUserId, userId),
      eq(creditLedger.creditBucket, "paid")
    )
    const [balance] = await tx
      .select({
        amount: sql<number>`coalesce(sum(${creditLedger.amount}),0)`,
      })
      .from(creditLedger)
      .where(owner)
    const [already] = await tx
      .select({
        amount: sql<number>`coalesce(sum(${creditLedger.amount}),0)`,
      })
      .from(creditLedger)
      .where(
        and(
          owner,
          eq(creditLedger.entryType, "grant"),
          gte(creditLedger.grantPeriod, start.toISOString()),
          lt(creditLedger.grantPeriod, end.toISOString())
        )
      )
    const [reserved] = await tx
      .select({
        amount: sql<number>`coalesce(sum(-${creditLedger.amount}),0)`,
      })
      .from(creditLedger)
      .where(
        and(
          owner,
          eq(creditLedger.entryType, "reservation"),
          sql`NOT EXISTS (SELECT 1 FROM credit_ledger finalized WHERE finalized.workspace_type=${creditLedger.workspaceType} AND finalized.workspace_id=${creditLedger.workspaceId} AND finalized.beneficiary_user_id=${creditLedger.beneficiaryUserId} AND finalized.ai_request_id=${creditLedger.aiRequestId} AND finalized.credit_bucket=${creditLedger.creditBucket} AND finalized.entry_type IN ('settlement','refund'))`
        )
      )
    const amount = Math.max(
      0,
      Math.min(
        target - Number(already?.amount ?? 0),
        (policy.rolloverCap ?? monthly * 3) -
          Number(balance?.amount ?? 0) -
          Number(reserved?.amount ?? 0)
      )
    )
    if (Number(already?.amount ?? 0) >= target) return 0
    const inserted = await tx
      .insert(creditLedger)
      .values({
        id: randomUUID(),
        workspaceType: workspace.type,
        workspaceId: workspace.id,
        beneficiaryUserId: userId,
        creditBucket: "paid",
        amount,
        entryType: "grant",
        grantPeriod: start.toISOString(),
        reason: "effective_plan_monthly_allowance",
        idempotencyKey: `allowance:${workspace.type}:${workspace.id}:${userId}:${start.toISOString()}:${target}`,
        createdAt: at.toISOString(),
      })
      .onConflictDoNothing()
      .returning({ id: creditLedger.id })
    return inserted.length ? amount : 0
  })
}
