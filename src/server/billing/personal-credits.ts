import { randomUUID } from "node:crypto"
import { and, eq, sql } from "drizzle-orm"
import type { CreditBucket, WorkspaceRef } from "@/server/entitlements/types"
import { readEffectiveSubscription } from "@/server/entitlements/effective"
import { grantWorkspaceAllowance } from "@/server/entitlements/allowances"
import { creditLedger, member, user } from "@/db/schema"
import { db } from "@/db/index"

export const PERSONAL_MONTHLY_CREDIT_GRANT = 100
export const PERSONAL_PAID_CREDIT_CAP = 300

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

async function balanceInTransaction(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  workspace: WorkspaceRef,
  userId: string,
  bucket: CreditBucket
): Promise<number> {
  const [row] = await tx
    .select({
      value: sql<number>`cast(coalesce(sum(${creditLedger.amount}), 0) as int)`,
    })
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
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  workspace: WorkspaceRef,
  userId: string
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`${workspace.type}:${workspace.id}:${userId}`}))`
  )
}

export async function grantPersonalMonthlyCredits(
  userId: string,
  periodStart: string
): Promise<number> {
  if (!Number.isFinite(Date.parse(periodStart)))
    throw new Error("Invalid billing period start.")
  // Webhooks may be replayed months later. The stored allowance clock selects
  // the current period; replaying an old provider period must not back-grant.
  return grantWorkspaceAllowance({ type: "personal", id: userId }, userId)
}

export async function reserveManagedAiCredits(
  workspace: WorkspaceRef,
  userId: string,
  requestId: string
): Promise<AiCreditReservation | null> {
  return db.transaction(async (tx) => {
    await lockCreditAccount(tx, workspace, userId)

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
      new Date(),
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

    const now = new Date().toISOString()
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
        createdAt: now,
      }))
    )

    return { requestId, workspace, userId, buckets }
  })
}

function creditsForCost(costUsd: number | null): number | null {
  if (costUsd === null || !Number.isFinite(costUsd) || costUsd < 0) return null
  if (costUsd === 0) return 0
  return Math.max(1, Math.ceil(costUsd * 100))
}

export async function settleManagedAiCredits(
  reservation: AiCreditReservation,
  costUsd: number | null
): Promise<void> {
  const reservedTotal = reservation.buckets.reduce(
    (total, item) => total + item.amount,
    0
  )
  const measured = creditsForCost(costUsd)
  let remainingCharge = measured ?? reservedTotal
  const now = new Date().toISOString()

  await db.transaction(async (tx) => {
    await lockCreditAccount(tx, reservation.workspace, reservation.userId)

    for (const [index, item] of reservation.buckets.entries()) {
      const isLast = index === reservation.buckets.length - 1
      const charged = isLast
        ? remainingCharge
        : Math.min(item.amount, remainingCharge)
      remainingCharge = Math.max(0, remainingCharge - charged)
      const settlement = item.amount - charged

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
            measured === null
              ? "spark_ai_cost_missing"
              : "spark_ai_request_settlement",
          idempotencyKey: `spark-ai:${reservation.requestId}:final:${item.bucket}`,
          createdAt: now,
        })
        .onConflictDoNothing()
    }
  })
}

export async function releaseManagedAiCredits(
  reservation: AiCreditReservation
): Promise<void> {
  await settleManagedAiCredits(reservation, 0)
}
