import { z } from "zod"
import type { Subscription } from "dodopayments/resources/subscriptions"
import type { DodoBillingConfig } from "./dodo-config"

export const teamPurchaseInput = z.object({
  interval: z.enum(["monthly", "annual"]),
  seats: z.number().int().min(1).max(10),
})
export type TeamPurchase = z.infer<typeof teamPurchaseInput>

export function teamCart(config: DodoBillingConfig, input: TeamPurchase) {
  const { interval, seats } = teamPurchaseInput.parse(input)
  const product = config.teamProducts?.[interval]
  if (!product)
    throw new Error("Team billing is not configured yet. Contact Sparkable.")
  if (Object.values(config.personalProducts).includes(product.productId))
    throw new Error("Team billing must use separate Pro products.")
  return {
    product_id: product.productId,
    quantity: 1,
    addons:
      seats > 1 ? [{ addon_id: product.addonId, quantity: seats - 1 }] : [],
  }
}

export function teamPurchaseFromProvider(
  config: DodoBillingConfig,
  remote: Pick<Subscription, "product_id" | "quantity" | "addons">
): TeamPurchase {
  const interval = (["monthly", "annual"] as const).find(
    (key) => config.teamProducts?.[key].productId === remote.product_id
  )
  if (!interval || remote.quantity !== 1)
    throw new Error("Unknown Team billing product or quantity.")
  const addonId = config.teamProducts![interval].addonId
  if (
    remote.addons.length > 1 ||
    remote.addons.some((a) => a.addon_id !== addonId)
  )
    throw new Error("Unknown Team seat add-on.")
  const extra = remote.addons[0]?.quantity ?? 0
  if (!Number.isInteger(extra) || extra < 0)
    throw new Error("Invalid Team seat quantity.")
  return teamPurchaseInput.parse({ interval, seats: 1 + extra })
}

export function teamLifecycle(
  remote: Subscription,
  previous: {
    subscriptionStatus: string
    failedPaymentGraceDeadline: string | null
    currentPeriodStart: string | null
  },
  now = new Date()
) {
  const paidBefore = Boolean(previous.currentPeriodStart)
  const grace =
    previous.failedPaymentGraceDeadline ??
    new Date(now.getTime() + 13 * 86400000).toISOString()
  if (remote.status === "paused")
    return {
      subscriptionStatus: "past_due" as const,
      accessState: "read_only" as const,
      failedPaymentGraceDeadline: now.toISOString(),
    }
  if (remote.status === "active")
    return {
      subscriptionStatus: remote.cancel_at_next_billing_date
        ? ("canceled" as const)
        : ("active" as const),
      accessState: "active" as const,
      failedPaymentGraceDeadline: null,
    }
  if (
    remote.status === "on_hold" ||
    remote.status === "failed" ||
    (remote.status as string) === "past_due"
  )
    return {
      subscriptionStatus: paidBefore
        ? ("past_due" as const)
        : ("checkout_pending" as const),
      accessState:
        paidBefore && Date.parse(grace) > now.getTime()
          ? ("active" as const)
          : ("read_only" as const),
      failedPaymentGraceDeadline: paidBefore ? grace : null,
    }
  return {
    subscriptionStatus:
      remote.status === "pending"
        ? ("checkout_pending" as const)
        : ("canceled" as const),
    accessState: "read_only" as const,
    failedPaymentGraceDeadline: null,
  }
}
