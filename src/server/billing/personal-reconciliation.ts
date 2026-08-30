import { and, eq } from "drizzle-orm"
import { personalIntervalForProduct } from "./dodo-config"
import { reconcilePersonalSubscriptionFromDodo } from "./personal-webhooks"
import type DodoPayments from "dodopayments"
import type { SubscriptionListResponse } from "dodopayments/resources/subscriptions"
import type { DodoBillingConfig } from "./dodo-config"
import { db } from "@/db/index"
import { workspaceSubscriptions } from "@/db/schema"

function metadataValue(
  metadata: Record<string, unknown>,
  key: string
): string | null {
  const value = metadata[key]
  return typeof value === "string" && value.length > 0 ? value : null
}

function belongsToPersonalWorkspace(
  subscription: SubscriptionListResponse,
  userId: string,
  config: DodoBillingConfig
): boolean {
  if (!personalIntervalForProduct(config, subscription.product_id)) return false

  const metadata = subscription.metadata as Record<string, unknown>
  return (
    metadataValue(metadata, "billingSubjectType") === "personal" &&
    metadataValue(metadata, "billingSubjectId") === userId
  )
}

/**
 * Repairs the short window where Dodo has completed checkout but the signed
 * webhook has not updated Sparkfeed yet. This runs only while the local row is
 * checkout_pending, so normal Billing loads do not make provider API calls.
 */
export async function reconcilePendingPersonalCheckout(
  userId: string,
  client: DodoPayments,
  config: DodoBillingConfig
): Promise<boolean> {
  const [local] = await db
    .select({
      status: workspaceSubscriptions.subscriptionStatus,
      customerId: workspaceSubscriptions.dodoCustomerId,
    })
    .from(workspaceSubscriptions)
    .where(
      and(
        eq(workspaceSubscriptions.workspaceType, "personal"),
        eq(workspaceSubscriptions.workspaceId, userId)
      )
    )
    .limit(1)

  if (local?.status !== "checkout_pending" || !local.customerId) return false

  const page = await client.subscriptions.list({
    customer_id: local.customerId,
    page_number: 1,
    page_size: 20,
  })
  const latest = page.items
    .filter((subscription) =>
      belongsToPersonalWorkspace(subscription, userId, config)
    )
    .sort(
      (left, right) =>
        new Date(right.created_at).getTime() -
        new Date(left.created_at).getTime()
    )[0]

  if (!latest || latest.status === "pending") return false

  const subscription = await client.subscriptions.retrieve(
    latest.subscription_id
  )
  await reconcilePersonalSubscriptionFromDodo(subscription, new Date(), config)
  return true
}
