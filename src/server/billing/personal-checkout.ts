import { randomUUID } from "node:crypto"
import { and, eq } from "drizzle-orm"
import {
  productForPersonalInterval,
  readDodoBillingConfig,
} from "./dodo-config"
import { ensurePersonalDodoCustomer } from "./personal-customer"
import type DodoPayments from "dodopayments"
import type { CheckoutSessionResponse } from "dodopayments/resources/checkout-sessions"
import type { DodoBillingConfig, PersonalBillingInterval } from "./dodo-config"
import { db } from "@/db/index"
import { workspaceSubscriptions } from "@/db/schema"

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
  const [existing] = await db
    .select({
      planKey: workspaceSubscriptions.planKey,
      subscriptionStatus: workspaceSubscriptions.subscriptionStatus,
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
    existing?.planKey === "personal_plus" &&
    existing.subscriptionStatus !== "canceled"
  ) {
    throw new Error(
      "Personal+ is already active. Open the billing portal instead."
    )
  }
  if (
    existing?.subscriptionStatus === "checkout_pending" &&
    Date.now() - new Date(existing.updatedAt).getTime() < 30 * 60 * 1000
  ) {
    throw new Error(
      "A Personal+ checkout is already pending. Try again in a few minutes."
    )
  }

  const customerId = await ensurePersonalDodoCustomer(
    userId,
    client,
    config.environment
  )
  const productId = productForPersonalInterval(config, interval)
  const productKey = `personal-${interval}`
  const now = new Date().toISOString()

  await db
    .insert(workspaceSubscriptions)
    .values({
      workspaceType: "personal",
      workspaceId: userId,
      planKey: "free",
      billingSource: "dodo",
      subscriptionStatus: "checkout_pending",
      accessState: "active",
      billingInterval: interval,
      paidSeatQuantity: 1,
      dodoCustomerId: customerId,
      productKey,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        workspaceSubscriptions.workspaceType,
        workspaceSubscriptions.workspaceId,
      ],
      set: {
        billingSource: "dodo",
        subscriptionStatus: "checkout_pending",
        accessState: "active",
        billingInterval: interval,
        dodoCustomerId: customerId,
        dodoSubscriptionId: null,
        productKey,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        failedPaymentGraceDeadline: null,
        updatedAt: now,
      },
    })

  let session: CheckoutSessionResponse
  try {
    session = await client.checkoutSessions.create(
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
        },
        feature_flags: {
          allow_customer_editing_email: false,
          allow_customer_editing_name: false,
          always_create_new_customer: false,
          redirect_immediately: true,
        },
      },
      { idempotencyKey: `personal-checkout:${userId}:${randomUUID()}` }
    )
  } catch (error) {
    await db
      .update(workspaceSubscriptions)
      .set({ subscriptionStatus: "free", updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(workspaceSubscriptions.workspaceType, "personal"),
          eq(workspaceSubscriptions.workspaceId, userId),
          eq(workspaceSubscriptions.subscriptionStatus, "checkout_pending")
        )
      )
    throw error
  }

  if (!session.checkout_url) {
    await db
      .update(workspaceSubscriptions)
      .set({ subscriptionStatus: "free", updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(workspaceSubscriptions.workspaceType, "personal"),
          eq(workspaceSubscriptions.workspaceId, userId),
          eq(workspaceSubscriptions.subscriptionStatus, "checkout_pending")
        )
      )
    throw new Error("Dodo Payments did not return a checkout URL.")
  }

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
