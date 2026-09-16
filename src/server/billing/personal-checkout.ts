import { randomUUID } from "node:crypto"
import { and, eq } from "drizzle-orm"
import {
  productForPersonalInterval,
  readDodoBillingConfig,
} from "./dodo-config"
import { ensurePersonalDodoCustomer } from "./personal-customer"
import {
  canReplaceUnusedCheckout,
  isDefinitiveProviderRejection,
} from "./request-safety"
import type DodoPayments from "dodopayments"
import type { DodoBillingConfig, PersonalBillingInterval } from "./dodo-config"
import { db } from "@/db/index"
import {
  personalCheckoutState,
  user,
  workspaceSubscriptions,
} from "@/db/schema"

export interface PersonalCheckoutResult {
  checkoutUrl: string
  checkoutSessionId: string
}

export async function createPersonalCheckout(
  userId: string,
  interval: PersonalBillingInterval,
  client: DodoPayments,
  config: DodoBillingConfig
): Promise<PersonalCheckoutResult> {
  const customerId = await ensurePersonalDodoCustomer(
    userId,
    client,
    config.environment
  )
  const productId = productForPersonalInterval(config, interval)
  const productKey = `personal-${interval}`
  const prepared = await db.transaction(async (tx) => {
    const owner = tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, userId))
    if (typeof owner.for === "function") owner.for("update")
    await owner.limit(1)
    const [existing] = await tx
      .select()
      .from(workspaceSubscriptions)
      .where(
        and(
          eq(workspaceSubscriptions.workspaceType, "personal"),
          eq(workspaceSubscriptions.workspaceId, userId)
        )
      )
      .limit(1)
    const [state] = await tx
      .select()
      .from(personalCheckoutState)
      .where(eq(personalCheckoutState.userId, userId))
      .limit(1)
    let previousAttemptEnded = false
    for await (const remote of client.subscriptions.list({
      customer_id: customerId,
    })) {
      if (!Object.values(config.personalProducts).includes(remote.product_id))
        continue
      if (!["failed", "cancelled"].includes(remote.status))
        throw new Error(
          "A Personal+ subscription already exists. Use Manage billing to recover or change it instead of paying again."
        )
      if (state && remote.metadata.checkoutAttemptId === state.attemptId)
        previousAttemptEnded = true
    }
    if (
      existing?.planKey === "personal_plus" &&
      existing.accessState === "active"
    )
      throw new Error(
        "Personal+ is already active. Open the billing portal instead."
      )
    if (state && !previousAttemptEnded) {
      previousAttemptEnded = await canReplaceUnusedCheckout(
        client,
        state.checkoutSessionId,
        state.createdAt
      )
    }
    if (state && !previousAttemptEnded) {
      if (state.checkoutUrl && state.checkoutSessionId)
        return {
          kind: "ready" as const,
          checkoutUrl: state.checkoutUrl,
          checkoutSessionId: state.checkoutSessionId,
        }
      throw new Error(
        "Your checkout is still processing or its response was lost. Refresh billing or contact support. A second checkout is blocked to prevent duplicate subscriptions."
      )
    }
    // Older pending checkouts have no durable session record. Never discard one merely because time passed.
    if (!state && existing?.subscriptionStatus === "checkout_pending")
      throw new Error(
        "A Personal+ checkout is already pending. Refresh billing or contact support before starting another."
      )
    const attemptId = randomUUID(),
      now = new Date().toISOString()
    await tx
      .insert(personalCheckoutState)
      .values({ userId, attemptId, createdAt: now })
      .onConflictDoUpdate({
        target: personalCheckoutState.userId,
        set: {
          attemptId,
          checkoutUrl: null,
          checkoutSessionId: null,
          createdAt: now,
        },
      })
    const values = {
      billingSource: "dodo" as const,
      subscriptionStatus: "checkout_pending" as const,
      accessState: "active" as const,
      billingInterval: interval,
      dodoCustomerId: customerId,
      dodoSubscriptionId: null,
      productKey,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      failedPaymentGraceDeadline: null,
      updatedAt: now,
    }
    await tx
      .insert(workspaceSubscriptions)
      .values({
        workspaceType: "personal",
        workspaceId: userId,
        planKey: "free",
        paidSeatQuantity: 1,
        createdAt: now,
        ...values,
      })
      .onConflictDoUpdate({
        target: [
          workspaceSubscriptions.workspaceType,
          workspaceSubscriptions.workspaceId,
        ],
        set: values,
      })
    return { kind: "create" as const, attemptId }
  })
  if (prepared.kind === "ready")
    return {
      checkoutUrl: prepared.checkoutUrl,
      checkoutSessionId: prepared.checkoutSessionId,
    }
  // A network failure leaves the committed attempt in place. Never automatically repeat a creating request.
  const session = await client.checkoutSessions
    .create(
      {
        product_cart: [{ product_id: productId, quantity: 1 }],
        customer: { customer_id: customerId },
        return_url: `${config.appUrl}/settings?tab=billing`,
        cancel_url: `${config.appUrl}/settings?tab=billing`,
        metadata: {
          billingSubjectType: "personal",
          billingSubjectId: userId,
          productKey,
          environment: config.environment,
          checkoutAttemptId: prepared.attemptId,
        },
        feature_flags: {
          allow_customer_editing_email: false,
          allow_customer_editing_name: false,
          always_create_new_customer: false,
          redirect_immediately: true,
        },
      },
      { maxRetries: 0 }
    )
    .catch(async (error: unknown) => {
      if (isDefinitiveProviderRejection(error))
        await db.transaction(async (tx) => {
          await tx
            .delete(personalCheckoutState)
            .where(
              and(
                eq(personalCheckoutState.userId, userId),
                eq(personalCheckoutState.attemptId, prepared.attemptId)
              )
            )
          await tx
            .update(workspaceSubscriptions)
            .set({ subscriptionStatus: "free" })
            .where(
              and(
                eq(workspaceSubscriptions.workspaceType, "personal"),
                eq(workspaceSubscriptions.workspaceId, userId),
                eq(
                  workspaceSubscriptions.subscriptionStatus,
                  "checkout_pending"
                )
              )
            )
        })
      throw error
    })
  if (!session.checkout_url)
    throw new Error(
      "Dodo did not return a checkout link. Contact support before retrying."
    )
  await db
    .update(personalCheckoutState)
    .set({
      checkoutUrl: session.checkout_url,
      checkoutSessionId: session.session_id,
    })
    .where(
      and(
        eq(personalCheckoutState.userId, userId),
        eq(personalCheckoutState.attemptId, prepared.attemptId)
      )
    )
  return {
    checkoutUrl: session.checkout_url,
    checkoutSessionId: session.session_id,
  }
}

export function currentDodoBillingConfig(): DodoBillingConfig {
  const config = readDodoBillingConfig()
  if (!config) throw new Error("Personal+ billing is unavailable.")
  return config
}
