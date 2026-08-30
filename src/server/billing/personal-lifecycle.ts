import { randomUUID } from "node:crypto"
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm"
import type { WorkspaceRef } from "@/server/entitlements/types"
import { db } from "@/db/index"
import { creditLedger, feeds, workspaceSubscriptions } from "@/db/schema"
import { creditBalance } from "@/server/entitlements/credits"

const FREE_NO_RSS_LIMIT = 5
const PERSONAL_PLUS_NO_RSS_LIMIT = 50
const PAID_CREDIT_RETENTION_DAYS = 30

function plusDays(date: Date, days: number): string {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000).toISOString()
}

async function setActivePageSources(
  userId: string,
  activeIds: Array<string>,
  now: string
): Promise<void> {
  await db
    .update(feeds)
    .set({ entitlementPausedAt: now })
    .where(and(eq(feeds.workspaceId, userId), eq(feeds.kind, "page")))

  if (activeIds.length > 0) {
    await db
      .update(feeds)
      .set({ entitlementPausedAt: null })
      .where(
        and(
          eq(feeds.workspaceId, userId),
          eq(feeds.kind, "page"),
          inArray(feeds.id, activeIds)
        )
      )
  }
}

async function firstPageSourceIds(
  userId: string,
  limit: number
): Promise<Array<string>> {
  const rows = await db
    .select({ id: feeds.id })
    .from(feeds)
    .where(and(eq(feeds.workspaceId, userId), eq(feeds.kind, "page")))
    .orderBy(asc(feeds.createdAt), asc(feeds.id))
    .limit(limit)
  return rows.map((row) => row.id)
}

export async function downgradePersonalWorkspace(
  userId: string,
  at: Date = new Date()
): Promise<void> {
  const now = at.toISOString()
  const activeIds = await firstPageSourceIds(userId, FREE_NO_RSS_LIMIT)
  await setActivePageSources(userId, activeIds, now)

  await db
    .update(workspaceSubscriptions)
    .set({
      planKey: "free",
      billingSource: "free",
      subscriptionStatus: "free",
      accessState: "active",
      billingInterval: null,
      failedPaymentGraceDeadline: null,
      paidCreditRetentionEndsAt: plusDays(at, PAID_CREDIT_RETENTION_DAYS),
      updatedAt: now,
    })
    .where(
      and(
        eq(workspaceSubscriptions.workspaceType, "personal"),
        eq(workspaceSubscriptions.workspaceId, userId)
      )
    )
}

export async function reactivatePersonalPlusSources(
  userId: string
): Promise<void> {
  const activeIds = await firstPageSourceIds(userId, PERSONAL_PLUS_NO_RSS_LIMIT)
  await setActivePageSources(userId, activeIds, new Date().toISOString())
}

export async function selectFreePersonalSources(
  userId: string,
  selectedIds: Array<string>
): Promise<void> {
  const uniqueIds = [...new Set(selectedIds)]
  if (uniqueIds.length > FREE_NO_RSS_LIMIT) {
    throw new Error(
      "Free workspaces can keep up to five no-RSS sources active."
    )
  }

  if (uniqueIds.length > 0) {
    const owned = await db
      .select({ id: feeds.id })
      .from(feeds)
      .where(
        and(
          eq(feeds.workspaceId, userId),
          eq(feeds.kind, "page"),
          inArray(feeds.id, uniqueIds)
        )
      )
    if (owned.length !== uniqueIds.length) {
      throw new Error(
        "One or more selected sources do not belong to this workspace."
      )
    }
  }

  await setActivePageSources(userId, uniqueIds, new Date().toISOString())
}

async function expireRetainedPaidCredits(
  userId: string,
  retentionEndsAt: string
): Promise<void> {
  const workspace: WorkspaceRef = { type: "personal", id: userId }
  const balance = Math.max(0, await creditBalance(workspace, userId, "paid"))
  await db
    .insert(creditLedger)
    .values({
      id: randomUUID(),
      workspaceType: "personal",
      workspaceId: userId,
      beneficiaryUserId: userId,
      creditBucket: "paid",
      amount: -balance,
      entryType: "expiry",
      reason: "paid_credit_retention_ended",
      idempotencyKey: `personal-paid-expiry:${userId}:${retentionEndsAt}`,
      createdAt: new Date().toISOString(),
    })
    .onConflictDoNothing()
}

export async function refreshPersonalSubscriptionLifecycle(
  userId: string,
  at: Date = new Date()
): Promise<void> {
  const [row] = await db
    .select()
    .from(workspaceSubscriptions)
    .where(
      and(
        eq(workspaceSubscriptions.workspaceType, "personal"),
        eq(workspaceSubscriptions.workspaceId, userId)
      )
    )
    .limit(1)
  if (!row) return

  if (
    row.planKey === "personal_plus" &&
    row.subscriptionStatus === "canceled" &&
    row.currentPeriodEnd &&
    new Date(row.currentPeriodEnd) <= at
  ) {
    await downgradePersonalWorkspace(userId, at)
    return
  }

  if (
    row.subscriptionStatus === "past_due" &&
    row.failedPaymentGraceDeadline &&
    new Date(row.failedPaymentGraceDeadline) <= at &&
    row.accessState !== "read_only"
  ) {
    await db
      .update(workspaceSubscriptions)
      .set({ accessState: "read_only", updatedAt: at.toISOString() })
      .where(
        and(
          eq(workspaceSubscriptions.workspaceType, "personal"),
          eq(workspaceSubscriptions.workspaceId, userId)
        )
      )
  }

  if (
    row.planKey === "free" &&
    row.paidCreditRetentionEndsAt &&
    new Date(row.paidCreditRetentionEndsAt) <= at
  ) {
    await expireRetainedPaidCredits(userId, row.paidCreditRetentionEndsAt)
    await db
      .update(workspaceSubscriptions)
      .set({ paidCreditRetentionEndsAt: null, updatedAt: at.toISOString() })
      .where(
        and(
          eq(workspaceSubscriptions.workspaceType, "personal"),
          eq(workspaceSubscriptions.workspaceId, userId),
          isNotNull(workspaceSubscriptions.paidCreditRetentionEndsAt)
        )
      )
  }
}
