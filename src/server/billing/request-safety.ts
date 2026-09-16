/** These responses reject the request before execution. Timeouts, conflicts,
 * connection failures and server errors are ambiguous and must retain the guard. */
import type DodoPayments from "dodopayments"

export function isDefinitiveProviderRejection(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "status" in error &&
    [400, 401, 403, 404, 422].includes(Number(error.status))
  )
}

/** Hosted sessions expire after 24h. Add an hour of clock margin and require
 * provider proof that the session never created a payment before replacing it.
 * https://docs.dodopayments.com/developer-resources/checkout-session */
export async function canReplaceUnusedCheckout(
  client: DodoPayments,
  sessionId: string | null,
  requestedAt: string | null,
  now = Date.now()
): Promise<boolean> {
  const expiry = 25 * 60 * 60 * 1000
  if (!sessionId || !requestedAt || !(Date.parse(requestedAt) + expiry < now))
    return false
  const session = await client.checkoutSessions.retrieve(sessionId)
  return (
    session.id === sessionId &&
    Date.parse(session.created_at) + expiry < now &&
    session.payment_id == null &&
    session.payment_status == null
  )
}
