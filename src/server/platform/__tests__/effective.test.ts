import { describe, expect, it } from "vitest"
import type {
  Subscription,
  WorkspaceOverride,
} from "@/server/entitlements/effective"
import { effectiveSubscription } from "@/server/entitlements/effective"
import { allowancePeriod } from "@/server/entitlements/allowances"

const base = {
  planKey: "personal_plus",
  accessState: "active",
  subscriptionStatus: "active",
  billingSource: "dodo",
  dodoSubscriptionId: "sub-stable",
  dodoCustomerId: "cus-stable",
  overrideSeatLimit: null,
  overrideMonthlyAiCredits: null,
  overrideSourceUnitLimit: null,
  overrideApiAccess: null,
  overrideMcpAccess: null,
} as Subscription
const override = {
  planKey: null,
  accessRestriction: "suspended",
  expiresAt: "2026-10-01T00:00:00Z",
} as WorkspaceOverride
const at = new Date("2026-09-05T00:00:00Z")
describe("effective access", () => {
  it("billing updates cannot clear a live operator suspension", () => {
    expect(
      effectiveSubscription({ ...base, accessState: "active" }, override, at)
    ).toMatchObject({
      accessState: "suspended",
      dodoSubscriptionId: "sub-stable",
      billingSource: "dodo",
    })
  })
  it("expiry resolves against latest billing, never a stale snapshot", () => {
    expect(
      effectiveSubscription(
        { ...base, planKey: "free", accessState: "read_only" },
        override,
        new Date("2026-10-02")
      )
    ).toMatchObject({ planKey: "free", accessState: "read_only" })
  })
  it("complimentary access retains provider status and identifiers", () => {
    expect(
      effectiveSubscription(
        {
          ...base,
          planKey: "free",
          subscriptionStatus: "canceled",
          accessState: "read_only",
        },
        {
          ...override,
          planKey: "personal_plus",
          accessRestriction: null,
          expiresAt: null,
        },
        at
      )
    ).toMatchObject({
      planKey: "personal_plus",
      subscriptionStatus: "canceled",
      accessState: "active",
      dodoCustomerId: "cus-stable",
    })
  })
  it("clamps monthly anniversaries without drifting", () => {
    expect(
      allowancePeriod(
        new Date("2026-01-31T12:00:00Z"),
        new Date("2026-02-28T15:00:00Z")
      )
    ).toEqual({
      start: new Date("2026-02-28T12:00:00Z"),
      end: new Date("2026-03-31T12:00:00Z"),
    })
  })
})
