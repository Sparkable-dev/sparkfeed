import { randomUUID } from "node:crypto"
import { and, eq, sql } from "drizzle-orm"
import { FREE_SPARK_AI_CREDITS } from "./plan-policy"
import type { CreditBucket, WorkspaceRef } from "./types"
import { db } from "@/db/index"
import { creditLedger, workspaceSubscriptions } from "@/db/schema"

export const CLOUD_FREE_CREDIT_GRANT = FREE_SPARK_AI_CREDITS

export function freeCreditGrantKey(userId: string): string {
  return `cloud-free:user:${userId}`
}

export async function ensureCloudFreeAccount(
  workspace: WorkspaceRef,
  userId: string,
  emailVerified: boolean
): Promise<void> {
  if (workspace.type !== "personal" || workspace.id !== userId) return

  const now = new Date().toISOString()
  await db
    .insert(workspaceSubscriptions)
    .values({
      workspaceType: "personal",
      workspaceId: userId,
      planKey: "free",
      billingSource: "free",
      subscriptionStatus: "free",
      accessState: "active",
      paidSeatQuantity: 1,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()

  if (!emailVerified) return

  await db
    .insert(creditLedger)
    .values({
      id: randomUUID(),
      workspaceType: "personal",
      workspaceId: userId,
      beneficiaryUserId: userId,
      creditBucket: "free",
      amount: CLOUD_FREE_CREDIT_GRANT,
      entryType: "grant",
      reason: "cloud_free_verified_account",
      idempotencyKey: freeCreditGrantKey(userId),
      createdAt: now,
    })
    .onConflictDoNothing()
}

export async function creditBalance(
  workspace: WorkspaceRef,
  beneficiaryUserId: string,
  bucket?: CreditBucket
): Promise<number> {
  const [row] = await db
    .select({
      value: sql<number>`coalesce(sum(${creditLedger.amount}), 0)`,
    })
    .from(creditLedger)
    .where(
      and(
        eq(creditLedger.workspaceType, workspace.type),
        eq(creditLedger.workspaceId, workspace.id),
        eq(creditLedger.beneficiaryUserId, beneficiaryUserId),
        bucket ? eq(creditLedger.creditBucket, bucket) : undefined
      )
    )

  return Number(row?.value ?? 0)
}
