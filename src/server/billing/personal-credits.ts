import { randomUUID } from "node:crypto"
import Decimal from "decimal.js"
import { and, eq, lt, sql } from "drizzle-orm"
import type { CreditBucket, WorkspaceRef } from "@/server/entitlements/types"
import type { AiUsageSummary } from "@/server/ai/usage"
import { readEffectiveSubscription } from "@/server/entitlements/effective"
import { grantWorkspaceAllowance } from "@/server/entitlements/allowances"
import {
  PERSONAL_PLUS_MONTHLY_SPARK_AI_CREDITS,
  sparkAiPlanPolicy,
} from "@/server/entitlements/plan-policy"
import { creditsForCost } from "@/server/ai/usage"
import { AI_BUSY } from "@/server/ai/errors"
import {
  aiUsageRequests,
  aiUsageSteps,
  creditLedger,
  member,
  user,
} from "@/db/schema"
import { db } from "@/db/index"

export const PERSONAL_MONTHLY_CREDIT_GRANT =
  PERSONAL_PLUS_MONTHLY_SPARK_AI_CREDITS
export const PERSONAL_PAID_CREDIT_CAP =
  sparkAiPlanPolicy("personal_plus").rolloverCap!
const STALE_REQUEST_MS = 15 * 60 * 1000

interface BucketReservation {
  bucket: CreditBucket
  amount: number
}

export interface AiCreditReservation {
  requestId: string
  workspace: WorkspaceRef
  userId: string
  buckets: Array<BucketReservation>
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

async function balanceInTransaction(
  tx: Transaction,
  workspace: WorkspaceRef,
  userId: string,
  bucket: CreditBucket
): Promise<number> {
  const [row] = await tx
    .select({ value: sql<number>`coalesce(sum(${creditLedger.amount}), 0)` })
    .from(creditLedger)
    .where(
      and(
        eq(creditLedger.workspaceType, workspace.type),
        eq(creditLedger.workspaceId, workspace.id),
        eq(creditLedger.beneficiaryUserId, userId),
        eq(creditLedger.creditBucket, bucket)
      )
    )
  return Number(row?.value ?? 0)
}

async function lockCreditAccount(
  tx: Transaction,
  workspace: WorkspaceRef,
  userId: string
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`${workspace.type}:${workspace.id}:${userId}`}))`
  )
}

async function refundStaleRequests(
  tx: Transaction,
  workspace: WorkspaceRef,
  userId: string,
  at: Date
) {
  const cutoff = new Date(at.getTime() - STALE_REQUEST_MS).toISOString()
  const stale = await tx
    .select({ id: aiUsageRequests.id })
    .from(aiUsageRequests)
    .where(
      and(
        eq(aiUsageRequests.workspaceType, workspace.type),
        eq(aiUsageRequests.workspaceId, workspace.id),
        eq(aiUsageRequests.beneficiaryUserId, userId),
        eq(aiUsageRequests.status, "in_progress"),
        lt(aiUsageRequests.startedAt, cutoff)
      )
    )

  for (const request of stale) {
    for (const bucket of ["free", "paid"] as const) {
      const [row] = await tx
        .select({
          amount: sql<number>`coalesce(sum(-${creditLedger.amount}), 0)`,
        })
        .from(creditLedger)
        .where(
          and(
            eq(creditLedger.aiRequestId, request.id),
            eq(creditLedger.creditBucket, bucket),
            eq(creditLedger.entryType, "reservation"),
            sql`NOT EXISTS (SELECT 1 FROM credit_ledger finalized WHERE finalized.ai_request_id=${request.id} AND finalized.credit_bucket=${bucket} AND finalized.entry_type IN ('settlement','refund'))`
          )
        )
      const amount = Number(row?.amount ?? 0)
      if (amount > 0) {
        await tx
          .insert(creditLedger)
          .values({
            id: randomUUID(),
            workspaceType: workspace.type,
            workspaceId: workspace.id,
            beneficiaryUserId: userId,
            creditBucket: bucket,
            amount,
            entryType: "refund",
            aiRequestId: request.id,
            reason: "spark_ai_stale_request_refund",
            idempotencyKey: `spark-ai:${request.id}:stale:${bucket}`,
            createdAt: at.toISOString(),
          })
          .onConflictDoNothing()
      }
    }
    await tx
      .update(aiUsageRequests)
      .set({ status: "stale", completedAt: at.toISOString() })
      .where(
        and(
          eq(aiUsageRequests.id, request.id),
          eq(aiUsageRequests.status, "in_progress")
        )
      )
  }
}

export async function grantPersonalMonthlyCredits(
  userId: string,
  periodStart: string
): Promise<number> {
  if (!Number.isFinite(Date.parse(periodStart)))
    throw new Error("Invalid billing period start.")
  return grantWorkspaceAllowance({ type: "personal", id: userId }, userId)
}

export async function reserveManagedAiCredits(
  workspace: WorkspaceRef,
  userId: string,
  requestId: string,
  requestedModelId?: string
): Promise<AiCreditReservation | null> {
  return db.transaction(async (tx) => {
    await lockCreditAccount(tx, workspace, userId)
    const now = new Date()
    await refundStaleRequests(tx, workspace, userId, now)

    const [active] = await tx
      .select({ id: aiUsageRequests.id })
      .from(aiUsageRequests)
      .where(
        and(
          eq(aiUsageRequests.workspaceType, workspace.type),
          eq(aiUsageRequests.workspaceId, workspace.id),
          eq(aiUsageRequests.beneficiaryUserId, userId),
          eq(aiUsageRequests.status, "in_progress")
        )
      )
      .limit(1)
    if (active) throw AI_BUSY()

    const [account] = await tx
      .select({ banned: user.banned, banExpires: user.banExpires })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
    if (
      account?.banned &&
      (!account.banExpires || account.banExpires > new Date())
    )
      return null
    if (workspace.type === "organization") {
      const [accepted] = await tx
        .select({ id: member.id })
        .from(member)
        .where(
          and(
            eq(member.organizationId, workspace.id),
            eq(member.userId, userId)
          )
        )
        .limit(1)
      if (!accepted) return null
    }
    const subscription = await readEffectiveSubscription(
      tx,
      workspace,
      now,
      true
    )
    if (!subscription || subscription.accessState !== "active") return null

    const allowedBuckets: Array<CreditBucket> =
      subscription.planKey === "free" ? ["free"] : ["free", "paid"]
    const buckets: Array<BucketReservation> = []
    for (const bucket of allowedBuckets) {
      const amount = Math.max(
        0,
        await balanceInTransaction(tx, workspace, userId, bucket)
      )
      if (amount > 0) buckets.push({ bucket, amount })
    }
    if (buckets.length === 0) return null

    const timestamp = now.toISOString()
    const reservedCredits = buckets.reduce(
      (total, item) => new Decimal(total).plus(item.amount).toNumber(),
      0
    )
    await tx.insert(aiUsageRequests).values({
      id: requestId,
      workspaceType: workspace.type,
      workspaceId: workspace.id,
      beneficiaryUserId: userId,
      planKey: subscription.planKey,
      requestedModelId: requestedModelId ?? null,
      status: "in_progress",
      reservedCredits,
      startedAt: timestamp,
    })
    await tx.insert(creditLedger).values(
      buckets.map(({ bucket, amount }) => ({
        id: randomUUID(),
        workspaceType: workspace.type,
        workspaceId: workspace.id,
        beneficiaryUserId: userId,
        creditBucket: bucket,
        amount: -amount,
        entryType: "reservation" as const,
        aiRequestId: requestId,
        reason: "spark_ai_request_reservation",
        idempotencyKey: `spark-ai:${requestId}:reserve:${bucket}`,
        createdAt: timestamp,
      }))
    )

    return { requestId, workspace, userId, buckets }
  })
}

function usageSummary(value: AiUsageSummary | number | null): AiUsageSummary {
  if (typeof value !== "number") {
    if (value) return value
    return emptyUsage("incomplete")
  }
  return {
    ...emptyUsage("completed"),
    costUsd: value,
    chargedCredits: creditsForCost(value),
  }
}

function emptyUsage(
  status: "completed" | "incomplete" | "error"
): AiUsageSummary {
  return {
    status,
    providerId: null,
    upstreamModelId: null,
    costUsd: 0,
    chargedCredits: 0,
    unpricedSteps: status === "incomplete" ? 1 : 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    steps: [],
  }
}

export async function settleManagedAiCredits(
  reservation: AiCreditReservation,
  usageValue: AiUsageSummary | number | null
): Promise<void> {
  const usage = usageSummary(usageValue)
  const reservedTotal = reservation.buckets.reduce(
    (total, item) => new Decimal(total).plus(item.amount).toNumber(),
    0
  )
  const chargedCredits = Decimal.min(
    new Decimal(reservedTotal),
    new Decimal(usage.chargedCredits)
  ).toDecimalPlaces(6, Decimal.ROUND_CEIL)
  const now = new Date().toISOString()

  await db.transaction(async (tx) => {
    await lockCreditAccount(tx, reservation.workspace, reservation.userId)
    const [request] = await tx
      .select({ status: aiUsageRequests.status })
      .from(aiUsageRequests)
      .where(eq(aiUsageRequests.id, reservation.requestId))
      .limit(1)
    if (!request || request.status !== "in_progress") return

    let remainingCharge = chargedCredits
    for (const item of reservation.buckets) {
      const charged = Decimal.min(new Decimal(item.amount), remainingCharge)
      remainingCharge = Decimal.max(0, remainingCharge.minus(charged))
      const settlement = new Decimal(item.amount).minus(charged).toNumber()
      await tx
        .insert(creditLedger)
        .values({
          id: randomUUID(),
          workspaceType: reservation.workspace.type,
          workspaceId: reservation.workspace.id,
          beneficiaryUserId: reservation.userId,
          creditBucket: item.bucket,
          amount: settlement,
          entryType: "settlement",
          aiRequestId: reservation.requestId,
          reason:
            usage.unpricedSteps > 0
              ? "spark_ai_partially_unpriced_settlement"
              : "spark_ai_request_settlement",
          idempotencyKey: `spark-ai:${reservation.requestId}:final:${item.bucket}`,
          createdAt: now,
        })
        .onConflictDoNothing()
    }

    if (usage.steps.length > 0) {
      await tx
        .insert(aiUsageSteps)
        .values(
          usage.steps.map((step) => ({
            ...step,
            requestId: reservation.requestId,
            createdAt: now,
          }))
        )
        .onConflictDoNothing()
    }
    await tx
      .update(aiUsageRequests)
      .set({
        providerId: usage.providerId,
        upstreamModelId: usage.upstreamModelId,
        status: usage.status,
        chargedCredits: chargedCredits.toNumber(),
        costUsd: usage.costUsd,
        unpricedSteps: usage.unpricedSteps,
        inputTokens: usage.inputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        outputTokens: usage.outputTokens,
        reasoningTokens: usage.reasoningTokens,
        totalTokens: usage.totalTokens,
        stepCount: usage.steps.length,
        completedAt: now,
      })
      .where(
        and(
          eq(aiUsageRequests.id, reservation.requestId),
          eq(aiUsageRequests.status, "in_progress")
        )
      )
  })
}

export async function releaseManagedAiCredits(
  reservation: AiCreditReservation
): Promise<void> {
  await settleManagedAiCredits(reservation, emptyUsage("error"))
}
