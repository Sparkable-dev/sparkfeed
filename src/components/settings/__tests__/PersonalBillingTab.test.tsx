// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const getSummary = vi.fn()

vi.mock("@/lib/demo", () => ({ DEMO_MODE: false }))
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    dodopayments: {
      customer: { portal: vi.fn() },
    },
  },
}))
vi.mock("@/server/personal-billing-actions", () => ({
  getPersonalBillingSummary: getSummary,
  startPersonalCheckout: vi.fn(),
  updateFreePersonalSources: vi.fn(),
}))

const { PersonalBillingTab } = await import("../PersonalBillingTab")

const base = {
  billingStatus: "free" as const,
  accessState: "active" as const,
  interval: null,
  currentPeriodEnd: null,
  graceDeadline: null,
  freeCredits: 50,
  paidCredits: 0,
  spendableCredits: 50,
  sourceLimit: 5,
  sources: [],
  portalAvailable: false,
}

describe("personal billing tab", () => {
  afterEach(cleanup)

  beforeEach(() => {
    getSummary.mockReset()
  })

  it("shows only server-defined Personal+ prices on Free", async () => {
    getSummary.mockResolvedValue({ ...base, plan: "free" })
    render(<PersonalBillingTab />)

    await waitFor(() =>
      expect(screen.getByText("Upgrade to Personal+")).toBeTruthy()
    )
    expect(screen.getByText("$5")).toBeTruthy()
    expect(screen.getByText("$48")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Choose monthly" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Choose annual" })).toBeTruthy()
    expect(screen.queryByText("Manage subscription and invoices")).toBeNull()
  })

  it("shows the portal action for an active Personal+ subscription", async () => {
    getSummary.mockResolvedValue({
      ...base,
      plan: "personal_plus",
      billingStatus: "active",
      interval: "monthly",
      paidCredits: 100,
      spendableCredits: 150,
      sourceLimit: 50,
      portalAvailable: true,
    })
    render(<PersonalBillingTab />)

    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "Manage subscription and invoices",
        })
      ).toBeTruthy()
    )
    expect(screen.queryByText("Upgrade to Personal+")).toBeNull()
    expect(screen.getByText("Team plans are coming soon")).toBeTruthy()
  })

  it("waits for a pending checkout instead of offering another checkout", async () => {
    getSummary.mockResolvedValue({
      ...base,
      plan: "free",
      billingStatus: "checkout_pending",
    })
    render(<PersonalBillingTab />)

    await waitFor(() =>
      expect(screen.getByText("Confirming your payment")).toBeTruthy()
    )
    expect(screen.queryByText("Upgrade to Personal+")).toBeNull()
    expect(screen.queryByRole("button", { name: "Choose monthly" })).toBeNull()
  })
})
