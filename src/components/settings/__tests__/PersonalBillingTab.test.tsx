// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const queries = vi.hoisted(() => ({ invalidateQueries: vi.fn() }))
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => queries }))

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
    expect(screen.queryByText("Open billing portal")).toBeNull()
  })

  it("shows the portal action for an active Personal+ subscription", async () => {
    getSummary.mockResolvedValue({
      ...base,
      plan: "personal_plus",
      billingStatus: "active",
      interval: "monthly",
      paidCredits: 150,
      spendableCredits: 149.95,
      sourceLimit: 50,
      portalAvailable: true,
    })
    render(<PersonalBillingTab />)

    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "Open billing portal",
        })
      ).toBeTruthy()
    )
    expect(screen.queryByText("Upgrade to Personal+")).toBeNull()
    expect(screen.queryByText("Team plans are coming soon")).toBeNull()
    expect(
      screen.getByText(
        "API, MCP, 50 no-RSS sources, and 150 monthly Spark AI credits."
      )
    ).toBeTruthy()
    expect(screen.getByText("149")).toBeTruthy()
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
  it("explains automatic Free fallback and provides a billing refresh", async () => {
    getSummary.mockResolvedValue({
      ...base,
      plan: "personal_plus",
      billingStatus: "past_due",
      graceDeadline: "2026-11-01T00:00:00Z",
    })
    render(<PersonalBillingTab />)
    expect(
      await screen.findByText(/Otherwise, this workspace returns to Free/)
    ).toBeTruthy()
    expect(screen.queryByText(/avoid read-only access/)).toBeNull()
    expect(
      screen.getByRole("button", { name: "Refresh billing status" })
    ).toBeTruthy()
  })

  it("keeps Free usable while explaining outstanding payment recovery without duplicate checkout", async () => {
    getSummary.mockResolvedValue({
      ...base,
      plan: "free",
      billingStatus: "past_due",
      portalAvailable: true,
    })
    render(<PersonalBillingTab />)
    expect(
      await screen.findByText(/Dodo may still retry your previous payment/)
    ).toBeTruthy()
    expect(screen.queryByText("Upgrade to Personal+")).toBeNull()
    expect(
      screen.getByRole("button", { name: "Open billing portal" })
    ).toBeTruthy()
  })
})
