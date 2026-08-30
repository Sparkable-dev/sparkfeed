import { createHash } from "node:crypto"
import { and, eq } from "drizzle-orm"
import {
  personalIntervalForProduct,
  readDodoBillingConfig,
} from "./dodo-config"
import { grantPersonalMonthlyCredits } from "./personal-credits"
import {
  downgradePersonalWorkspace,
  reactivatePersonalPlusSources,
} from "./personal-lifecycle"
import type DodoPayments from "dodopayments"
import type { UnwrapWebhookEvent } from "dodopayments/resources/webhooks/webhooks"
import type { Subscription } from "dodopayments/resources/subscriptions"
import type { DodoBillingConfig } from "./dodo-config"
import { db } from "@/db/index"
import { dodoWebhookInbox, user, workspaceSubscriptions } from "@/db/schema"

const PAYMENT_GRACE_DAYS = 13

const PERSONAL_SUBSCRIPTION_EVENTS = new Set([
  "subscription.active",
  "subscription.renewed",
  "subscription.updated",
  "subscription.plan_changed",
  "subscription.unpaused",
  "subscription.on_hold",
  "subscription.failed",
  "subscription.cancelled",
  "subscription.expired",
  "subscription.paused",
])

function iso(value: string | Date): string {
  const parsed = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new Error("Invalid Dodo timestamp.")
  return parsed.toISOString()
}

function graceDeadline(eventTime: string): string {
  return new Date(
    new Date(eventTime).getTime() + PAYMENT_GRACE_DAYS * 24 * 60 * 60 * 1000
  ).toISOString()
}

function metadataString(
  metadata: Record<string, unknown>,
  key: string
): string | null {
  const value = metadata[key]
  return typeof value === "string" && value.length > 0 ? value : null
}

function replaySubject(event: UnwrapWebhookEvent): {
  subjectType: "personal" | "organization" | null
  subjectId: string | null
  dodoSubscriptionId: string | null
} {
  if (!PERSONAL_SUBSCRIPTION_EVENTS.has(event.type)) {
    return { subjectType: null, subjectId: null, dodoSubscriptionId: null }
  }

  const subscription = event.data as Subscription
  const metadata = subscription.metadata as Record<string, unknown>
  const rawType = metadataString(metadata, "billingSubjectType")
  return {
    subjectType:
      rawType === "personal" || rawType === "organization" ? rawType : null,
    subjectId: metadataString(metadata, "billingSubjectId"),
    dodoSubscriptionId: subscription.subscription_id || null,
  }
}

async function applyPersonalSubscriptionEvent(
  event: UnwrapWebhookEvent,
  config: DodoBillingConfig
): Promise<void> {
  if (!PERSONAL_SUBSCRIPTION_EVENTS.has(event.type)) return

  const subscription = event.data as Subscription
  const metadata = subscription.metadata as Record<string, unknown>
  if (metadataString(metadata, "billingSubjectType") !== "personal") return

  const userId = metadataString(metadata, "billingSubjectId")
  if (!userId) throw new Error("Personal subscription metadata has no user ID.")

  const interval = personalIntervalForProduct(config, subscription.product_id)
  if (!interval)
    throw new Error("Dodo subscription uses an unknown Personal+ product.")

  const [account] = await db
    .select({ dodoCustomerId: user.dodoCustomerId })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  if (!account?.dodoCustomerId) {
    throw new Error("Personal subscription has no local Dodo customer.")
  }
  if (account.dodoCustomerId !== subscription.customer.customer_id) {
    throw new Error("Dodo customer does not match the personal workspace.")
  }

  const eventAt = iso(event.timestamp)
  const periodStart = iso(subscription.previous_billing_date)
  const periodEnd = iso(subscription.next_billing_date)
  const [current] = await db
    .select({
      planKey: workspaceSubscriptions.planKey,
      subscriptionStatus: workspaceSubscriptions.subscriptionStatus,
      providerEventAt: workspaceSubscriptions.providerEventAt,
      dodoSubscriptionId: workspaceSubscriptions.dodoSubscriptionId,
      updatedAt: workspaceSubscriptions.updatedAt,
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
    current?.providerEventAt &&
    new Date(current.providerEventAt) >= new Date(eventAt)
  ) {
    return
  }
  if (
    current?.subscriptionStatus === "checkout_pending" &&
    new Date(current.updatedAt) > new Date(eventAt)
  ) {
    return
  }
  if (
    current?.dodoSubscriptionId &&
    current.dodoSubscriptionId !== subscription.subscription_id
  ) {
    throw new Error(
      "Dodo subscription does not match the local billing record."
    )
  }

  const now = new Date().toISOString()
  const common = {
    billingSource: "dodo" as const,
    billingInterval: interval,
    paidSeatQuantity: 1,
    dodoCustomerId: subscription.customer.customer_id,
    dodoSubscriptionId: subscription.subscription_id,
    productKey: `personal-${interval}`,
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    providerEventAt: eventAt,
    updatedAt: now,
  }

  if (
    event.type === "subscription.active" ||
    event.type === "subscription.renewed"
  ) {
    await db
      .update(workspaceSubscriptions)
      .set({
        ...common,
        planKey: "personal_plus",
        subscriptionStatus: "active",
        accessState: "active",
        failedPaymentGraceDeadline: null,
        paidCreditRetentionEndsAt: null,
      })
      .where(
        and(
          eq(workspaceSubscriptions.workspaceType, "personal"),
          eq(workspaceSubscriptions.workspaceId, userId)
        )
      )
    await reactivatePersonalPlusSources(userId)
    await grantPersonalMonthlyCredits(userId, periodStart)
    return
  }

  if (
    event.type === "subscription.updated" ||
    event.type === "subscription.plan_changed" ||
    event.type === "subscription.unpaused"
  ) {
    await db
      .update(workspaceSubscriptions)
      .set({
        ...common,
        planKey: "personal_plus",
        subscriptionStatus:
          subscription.status === "active" ? "active" : "past_due",
        accessState: subscription.status === "active" ? "active" : "read_only",
        failedPaymentGraceDeadline:
          subscription.status === "active" ? null : graceDeadline(eventAt),
        paidCreditRetentionEndsAt: null,
      })
      .where(
        and(
          eq(workspaceSubscriptions.workspaceType, "personal"),
          eq(workspaceSubscriptions.workspaceId, userId)
        )
      )
    return
  }

  if (
    event.type === "subscription.on_hold" ||
    event.type === "subscription.failed"
  ) {
    // A declined first payment is not a paid-plan renewal failure. Keep the
    // Dodo customer for a retry, but remove the failed subscription reference
    // so a fresh checkout can activate without colliding with it.
    if (current?.planKey !== "personal_plus") {
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
          providerEventAt: eventAt,
          dodoCustomerId: subscription.customer.customer_id,
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
      return
    }

    await db
      .update(workspaceSubscriptions)
      .set({
        ...common,
        planKey: "personal_plus",
        subscriptionStatus: "past_due",
        accessState: "active",
        failedPaymentGraceDeadline: graceDeadline(eventAt),
      })
      .where(
        and(
          eq(workspaceSubscriptions.workspaceType, "personal"),
          eq(workspaceSubscriptions.workspaceId, userId)
        )
      )
    return
  }

  if (event.type === "subscription.cancelled") {
    await db
      .update(workspaceSubscriptions)
      .set({
        ...common,
        planKey: "personal_plus",
        subscriptionStatus: "canceled",
        accessState: "active",
        failedPaymentGraceDeadline: null,
      })
      .where(
        and(
          eq(workspaceSubscriptions.workspaceType, "personal"),
          eq(workspaceSubscriptions.workspaceId, userId)
        )
      )
    return
  }

  if (event.type === "subscription.paused") {
    await db
      .update(workspaceSubscriptions)
      .set({
        ...common,
        planKey: "personal_plus",
        subscriptionStatus: "past_due",
        accessState: "read_only",
        failedPaymentGraceDeadline: eventAt,
      })
      .where(
        and(
          eq(workspaceSubscriptions.workspaceType, "personal"),
          eq(workspaceSubscriptions.workspaceId, userId)
        )
      )
    return
  }

  await db
    .update(workspaceSubscriptions)
    .set({ ...common, providerEventAt: eventAt })
    .where(
      and(
        eq(workspaceSubscriptions.workspaceType, "personal"),
        eq(workspaceSubscriptions.workspaceId, userId)
      )
    )
  await downgradePersonalWorkspace(userId, new Date(eventAt))
}

function reconciliationEventType(
  status: Subscription["status"]
): UnwrapWebhookEvent["type"] {
  // An authoritative active reconciliation must run the same idempotent credit
  // grant as the original activation webhook. Mapping it to updated would
  // activate the plan without issuing the paid period allowance.
  if (status === "active") return "subscription.active"
  if (status === "on_hold") return "subscription.on_hold"
  if (status === "paused") return "subscription.paused"
  if (status === "cancelled") return "subscription.cancelled"
  if (status === "expired") return "subscription.expired"
  return "subscription.failed"
}

export async function reconcilePersonalSubscriptionFromDodo(
  subscription: Subscription,
  at = new Date(),
  config: DodoBillingConfig = readDodoBillingConfig() as DodoBillingConfig
): Promise<void> {
  if (!config) throw new Error("Dodo billing configuration is unavailable.")
  await applyPersonalSubscriptionEvent(
    {
      type: reconciliationEventType(subscription.status),
      timestamp: at.toISOString(),
      business_id: "admin-reconciliation",
      data: subscription,
    } as UnwrapWebhookEvent,
    config
  )
}

export async function ingestVerifiedDodoWebhook(input: {
  webhookId: string
  rawBody: string
  event: UnwrapWebhookEvent
  config?: DodoBillingConfig
}): Promise<{ duplicate: boolean }> {
  const config = input.config ?? readDodoBillingConfig()
  if (!config)
    throw new Error("Dodo webhooks are disabled in Community Edition.")

  const payloadHash = createHash("sha256").update(input.rawBody).digest("hex")
  const receivedAt = new Date().toISOString()
  const eventTime = iso(input.event.timestamp)
  const subject = replaySubject(input.event)

  await db
    .insert(dodoWebhookInbox)
    .values({
      webhookId: input.webhookId,
      eventType: input.event.type,
      eventTime,
      payloadHash,
      ...subject,
      processingStatus: "pending",
      attemptCount: 0,
      receivedAt,
    })
    .onConflictDoNothing()

  const [inbox] = await db
    .select()
    .from(dodoWebhookInbox)
    .where(eq(dodoWebhookInbox.webhookId, input.webhookId))
    .limit(1)
  if (!inbox) throw new Error("Could not store the Dodo webhook.")
  if (inbox.payloadHash !== payloadHash) {
    throw new Error("A Dodo webhook ID was reused with a different payload.")
  }
  if (inbox.processingStatus === "processed") return { duplicate: true }

  await db
    .update(dodoWebhookInbox)
    .set({
      processingStatus: "processing",
      attemptCount: inbox.attemptCount + 1,
      processingStartedAt: new Date().toISOString(),
      lastError: null,
    })
    .where(eq(dodoWebhookInbox.webhookId, input.webhookId))

  try {
    await applyPersonalSubscriptionEvent(input.event, config)
    await db
      .update(dodoWebhookInbox)
      .set({
        processingStatus: "processed",
        processedAt: new Date().toISOString(),
        lastError: null,
      })
      .where(eq(dodoWebhookInbox.webhookId, input.webhookId))
    return { duplicate: false }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown webhook error"
    await db
      .update(dodoWebhookInbox)
      .set({ processingStatus: "failed", lastError: message.slice(0, 500) })
      .where(eq(dodoWebhookInbox.webhookId, input.webhookId))
    throw error
  }
}

export function unwrapDodoWebhook(
  client: DodoPayments,
  rawBody: string,
  headers: Headers
): { webhookId: string; event: UnwrapWebhookEvent } {
  const webhookId = headers.get("webhook-id")
  const timestamp = headers.get("webhook-timestamp")
  const signature = headers.get("webhook-signature")
  if (!webhookId || !timestamp || !signature) {
    throw new Error("Dodo webhook headers are incomplete.")
  }

  const event = client.webhooks.unwrap(rawBody, {
    headers: {
      "webhook-id": webhookId,
      "webhook-timestamp": timestamp,
      "webhook-signature": signature,
    },
  })
  return { webhookId, event }
}
