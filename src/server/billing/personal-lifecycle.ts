import { randomUUID } from "node:crypto"
import { and, asc, eq, gt, inArray, isNotNull } from "drizzle-orm"
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

/**
 * Repairs records written by the pre-launch webhook handler, which treated a
 * declined first checkout as a failed renewal. A real Personal+ activation
 * always writes at least one positive paid grant in the same webhook flow.
 */
export async function repairFailedInitialPersonalCheckout(
  userId: string
): Promise<boolean> {
  const [subscription] = await db
    .select({
      planKey: workspaceSubscriptions.planKey,
      subscriptionStatus: workspaceSubscriptions.subscriptionStatus,
      providerEventAt: workspaceSubscriptions.providerEventAt,
    })
    .from(workspaceSubscriptions)
    .where(
      and(
        eq(workspaceSubscriptions.workspaceType, "personal"),
        eq(workspaceSubscriptions.workspaceId, userId)
      )
    )
    .limit(1)

  if (
    subscription?.planKey !== "personal_plus" ||
    subscription.subscriptionStatus !== "past_due"
  ) {
    return false
  }

  const [paidGrant] = await db
    .select({ id: creditLedger.id })
    .from(creditLedger)
    .where(
      and(
        eq(creditLedger.workspaceType, "personal"),
        eq(creditLedger.workspaceId, userId),
        eq(creditLedger.beneficiaryUserId, userId),
        eq(creditLedger.creditBucket, "paid"),
        eq(creditLedger.entryType, "grant"),
        gt(creditLedger.amount, 0)
      )
    )
    .limit(1)
  if (paidGrant) return false

  const now = new Date().toISOString()
  await db
    .update(workspaceSubscriptions)
    .set({
      planKey: "free",
      billingSource: "free",
      subscriptionStatus: "free",
      accessState: "active",
      billingInterval: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      failedPaymentGraceDeadline: null,
      paidCreditRetentionEndsAt: null,
      providerEventAt: subscription.providerEventAt,
      dodoSubscriptionId: null,
      productKey: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(workspaceSubscriptions.workspaceType, "personal"),
        eq(workspaceSubscriptions.workspaceId, userId)
      )
    )
  return true
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
