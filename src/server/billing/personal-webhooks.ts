import { createHash } from "node:crypto"
import { and, eq } from "drizzle-orm"
import {
  personalIntervalForProduct,
  readDodoBillingConfig,
} from "./dodo-config"
import { BILLING_GRACE_DAYS } from "./subscription-policy"
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

const PERSONAL_SUBSCRIPTION_EVENTS = new Set([
  "subscription.active",
  "subscription.renewed",
  "subscription.updated",
  "subscription.plan_changed",
  "subscription.unpaused",
  "subscription.on_hold",
  "subscription.past_due",
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
    new Date(eventTime).getTime() + BILLING_GRACE_DAYS * 24 * 60 * 60 * 1000
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
      failedPaymentGraceDeadline:
        workspaceSubscriptions.failedPaymentGraceDeadline,
      currentPeriodStart: workspaceSubscriptions.currentPeriodStart,
      currentPeriodEnd: workspaceSubscriptions.currentPeriodEnd,
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

  // Payload status is authoritative even for generic subscription.updated events.
  // Event names describe the notification, not a separate access state machine.
  const status =
    subscription.status === "active" &&
    subscription.cancel_at_next_billing_date &&
    Date.parse(periodEnd) <= Date.now()
      ? "cancelled"
      : (subscription.status as string)
  const where = and(
    eq(workspaceSubscriptions.workspaceType, "personal"),
    eq(workspaceSubscriptions.workspaceId, userId)
  )
  if (status === "active") {
    await db
      .update(workspaceSubscriptions)
      .set({
        ...common,
        planKey: "personal_plus",
        subscriptionStatus: subscription.cancel_at_next_billing_date
          ? "canceled"
          : "active",
        accessState: "active",
        failedPaymentGraceDeadline: null,
        paidCreditRetentionEndsAt: null,
      })
      .where(where)
    await reactivatePersonalPlusSources(userId)
    await grantPersonalMonthlyCredits(userId, periodStart)
    return
  }

  if (["cancelled", "expired", "paused", "failed"].includes(status)) {
    // A terminal cancellation/expiry has ended paid access. A paused personal
    // subscription also falls back to Free, preserving its data and billing link.
    if (current?.planKey === "personal_plus") {
      await db
        .update(workspaceSubscriptions)
        .set({ ...common })
        .where(where)
      await downgradePersonalWorkspace(userId, new Date(eventAt))
    } else {
      // Repeated terminal updates must not restart paid-credit retention.
      await db
        .update(workspaceSubscriptions)
        .set({
          planKey: "free",
          billingSource: "free",
          subscriptionStatus: "free",
          accessState: "active",
          billingInterval: null,
          failedPaymentGraceDeadline: null,
          providerEventAt: eventAt,
          dodoCustomerId: subscription.customer.customer_id,
          updatedAt: now,
          ...(status === "failed"
            ? {
                dodoSubscriptionId: null,
                productKey: null,
                currentPeriodStart: null,
                currentPeriodEnd: null,
              }
            : { dodoSubscriptionId: subscription.subscription_id }),
        })
        .where(where)
    }
    return
  }

  if (["on_hold", "past_due"].includes(status)) {
    if (current?.planKey !== "personal_plus") {
      // Never grant paid access after a failed first checkout or restart grace
      // after this subscription has already fallen back to Free.
      const funded = Boolean(
        current?.currentPeriodStart &&
        current.currentPeriodStart !== current.currentPeriodEnd
      )
      await db
        .update(workspaceSubscriptions)
        .set({
          planKey: "free",
          billingSource: funded ? "dodo" : "free",
          subscriptionStatus: funded ? "past_due" : "free",
          accessState: "active",
          billingInterval: null,
          failedPaymentGraceDeadline: funded
            ? current?.failedPaymentGraceDeadline
            : null,
          providerEventAt: eventAt,
          dodoCustomerId: subscription.customer.customer_id,
          ...(funded
            ? {}
            : {
                currentPeriodStart: null,
                currentPeriodEnd: null,
                dodoSubscriptionId: null,
                productKey: null,
              }),
          updatedAt: now,
        })
        .where(where)
      return
    }
    const deadline =
      current.failedPaymentGraceDeadline ?? graceDeadline(eventAt)
    await db
      .update(workspaceSubscriptions)
      .set({
        ...common,
        // A failed renewal is not a newly funded period.
        currentPeriodStart: current.currentPeriodStart,
        currentPeriodEnd: current.currentPeriodEnd,
        planKey: "personal_plus",
        subscriptionStatus: "past_due",
        accessState: "active",
        failedPaymentGraceDeadline: deadline,
      })
      .where(where)
    if (Date.parse(deadline) <= Date.now())
      await downgradePersonalWorkspace(userId, new Date(deadline), {
        paymentRecoveryPending: true,
      })
    return
  }

  if (status !== "pending") throw new Error("Unknown Dodo subscription status.")
  // Pending checkout cannot replace a previously funded subscription.
  if (current?.planKey === "personal_plus") return
  await db
    .update(workspaceSubscriptions)
    .set({
      ...common,
      planKey: "free",
      subscriptionStatus: "checkout_pending",
      accessState: "active",
      failedPaymentGraceDeadline: null,
    })
    .where(where)
}

function reconciliationEventType(
  status: Subscription["status"]
): UnwrapWebhookEvent["type"] {
  // An authoritative active reconciliation must run the same idempotent credit
  // grant as the original activation webhook. Mapping it to updated would
  // activate the plan without issuing the paid period allowance.
  if (status === "active") return "subscription.active"
  if (status === "on_hold") return "subscription.on_hold"
  if ((status as string) === "past_due") return "subscription.on_hold"
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
    if (subject.subjectType === "organization" && subject.dodoSubscriptionId) {
      const { dodoClient } = await import("./dodo-client")
      const { syncTeamSubscription, completePersonalUpgrade } =
        await import("./team-subscriptions")
      const observedAt = new Date()
      const remote = await dodoClient().subscriptions.retrieve(
        subject.dodoSubscriptionId
      )
      await syncTeamSubscription(remote, config, observedAt)
      if (subject.subjectId)
        await completePersonalUpgrade(subject.subjectId, dodoClient(), config)
    } else {
      await applyPersonalSubscriptionEvent(input.event, config)
    }
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
