import { describe, expect, it, vi } from "vitest"
import {
  canReplaceUnusedCheckout,
  isDefinitiveProviderRejection,
} from "../request-safety"
import type DodoPayments from "dodopayments"

describe("provider request safety", () => {
  it("replaces only an expired session that the provider confirms has no payment", async () => {
    const now = Date.now(),
      old = new Date(now - 26 * 3600000).toISOString()
    const retrieve = vi
      .fn()
      .mockResolvedValue({
        id: "cks-1",
        created_at: old,
        payment_id: null,
        payment_status: null,
      })
    const client = { checkoutSessions: { retrieve } } as unknown as DodoPayments
    expect(await canReplaceUnusedCheckout(client, "cks-1", old, now)).toBe(true)
    retrieve.mockResolvedValue({
      id: "cks-1",
      created_at: old,
      payment_id: "payment-processing",
      payment_status: "processing",
    })
    expect(await canReplaceUnusedCheckout(client, "cks-1", old, now)).toBe(
      false
    )
    expect(await canReplaceUnusedCheckout(client, null, old, now)).toBe(false)
    expect(
      await canReplaceUnusedCheckout(
        client,
        "cks-1",
        new Date(now).toISOString(),
        now
      )
    ).toBe(false)
    expect(retrieve).toHaveBeenCalledTimes(2)
  })
  it.each([400, 401, 403, 404, 422])(
    "permits corrected requests after rejection %i",
    (status) => {
      expect(isDefinitiveProviderRejection({ status })).toBe(true)
    }
  )
  it.each([408, 409, 429, 500, 502, 503, undefined])(
    "retains the guard for ambiguous response %s",
    (status) => {
      expect(isDefinitiveProviderRejection({ status })).toBe(false)
    }
  )
})
