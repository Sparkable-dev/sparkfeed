// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { WorkspaceDetail } from "@/server/workspace-management"

const mock = vi.hoisted(() => ({
  summary: vi.fn(),
  preview: vi.fn(),
  confirm: vi.fn(),
  cancel: vi.fn(),
  checkout: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))
vi.mock("sonner", () => ({
  toast: { success: mock.success, error: mock.error },
}))
vi.mock("@/server/team-billing-actions", () => ({
  getTeamBillingSummary: mock.summary,
  previewTeamChange: mock.preview,
  confirmTeamChange: mock.confirm,
  cancelTeamPlan: mock.cancel,
  checkoutTeam: mock.checkout,
  openTeamPortal: vi.fn(),
  cancelScheduledTeamChange: vi.fn(),
}))
const { OnlineTeamBillingPanel } = await import("./OnlineTeamBillingPanel")
const workspace = {
  id: "team",
  name: "Team QA",
  usedSeats: 1,
  seatCapacity: 3,
} as WorkspaceDetail
const active = {
  status: "active",
  plan: "pro",
  billingSource: "dodo",
  accessState: "active",
  interval: "monthly",
  paidSeats: 3,
  checkoutSeats: 3,
  periodEnd: "2026-10-16T00:00:00Z",
  graceDeadline: null,
  scheduledSeats: null,
  scheduledAt: null,
  scheduledInterval: null,
  pendingSeatReduction: null,
  portalAvailable: false,
  canCheckout: false,
  syncWarning: null,
}
beforeEach(() => {
  vi.clearAllMocks()
  mock.summary.mockResolvedValue(active)
  mock.preview.mockResolvedValue({
    token: "a".repeat(64),
    scheduled: false,
    quote: {
      amount: 1200,
      currency: "USD",
      effectiveAt: "2026-09-16T00:00:00Z",
      nextBillingDate: "2026-10-16T00:00:00Z",
    },
  })
  mock.confirm.mockResolvedValue({ scheduled: false })
  mock.cancel.mockResolvedValue({ success: true })
})
afterEach(cleanup)
describe("Team billing feedback", () => {
  it("announces confirmed recovery without submitting another payment", async () => {
    mock.summary
      .mockResolvedValueOnce({ ...active, status: "past_due" })
      .mockResolvedValue(active)
    render(<OnlineTeamBillingPanel workspace={workspace} onChanged={vi.fn()} />)
    await screen.findByText(/Payment needs attention/)
    fireEvent.click(screen.getByRole("button", { name: "Refresh billing" }))
    await waitFor(() =>
      expect(mock.success).toHaveBeenCalledWith(
        "Payment recovered. Your Pro workspace access is restored."
      )
    )
    expect(mock.checkout).not.toHaveBeenCalled()
    expect(mock.confirm).not.toHaveBeenCalled()
  })
  it("explains an occupied-seat reduction with Sonner before contacting billing", async () => {
    render(
      <OnlineTeamBillingPanel
        workspace={{ ...workspace, usedSeats: 3 }}
        onChanged={vi.fn()}
      />
    )
    await screen.findByText("Seats and billing interval")
    fireEvent.change(screen.getByLabelText("Paid seats, including the Owner"), {
      target: { value: "2" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Review plan change" }))
    await waitFor(() =>
      expect(mock.error).toHaveBeenCalledWith(
        "Remove 1 member or cancel pending invitations before reducing to 2 seats."
      )
    )
    expect(mock.preview).not.toHaveBeenCalled()
  })
  it("waits for explicit price confirmation and reports a submitted change, not paid access", async () => {
    render(<OnlineTeamBillingPanel workspace={workspace} onChanged={vi.fn()} />)
    await screen.findByText("Seats and billing interval")
    fireEvent.change(screen.getByLabelText("Paid seats, including the Owner"), {
      target: { value: "4" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Review plan change" }))
    await screen.findByText("Confirm your plan change")
    expect(screen.getByText("Due now: $12.00")).toBeTruthy()
    expect(mock.confirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Confirm change" }))
    await waitFor(() =>
      expect(mock.success).toHaveBeenCalledWith(
        "Plan change submitted. Waiting for payment confirmation."
      )
    )
    expect(mock.confirm).toHaveBeenCalledWith({
      data: {
        workspaceId: "team",
        interval: "monthly",
        seats: 4,
        previewToken: "a".repeat(64),
      },
    })
  })
  it("shows an actionable Sonner error and keeps the current subscription", async () => {
    mock.preview.mockRejectedValue(
      new Error("Billing provider is unavailable.")
    )
    render(<OnlineTeamBillingPanel workspace={workspace} onChanged={vi.fn()} />)
    fireEvent.click(
      await screen.findByRole("button", { name: "Review plan change" })
    )
    await waitFor(() =>
      expect(mock.error).toHaveBeenCalledWith(
        "Billing provider is unavailable."
      )
    )
    expect(screen.getByRole("alert").textContent).toContain(
      "Billing provider is unavailable."
    )
    expect(mock.confirm).not.toHaveBeenCalled()
  })
  it("only announces activation when the server confirms it", async () => {
    mock.summary
      .mockResolvedValueOnce({
        ...active,
        status: "checkout_pending",
        accessState: "read_only",
        canCheckout: true,
      })
      .mockResolvedValue(active)
    render(<OnlineTeamBillingPanel workspace={workspace} onChanged={vi.fn()} />)
    await screen.findByText("Activate Pro")
    expect(mock.success).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Refresh billing" }))
    await waitFor(() =>
      expect(mock.success).toHaveBeenCalledWith(
        "Your Pro workspace is active. You can now invite your team."
      )
    )
  })
  it("requires confirmation before scheduling cancellation", async () => {
    render(<OnlineTeamBillingPanel workspace={workspace} onChanged={vi.fn()} />)
    fireEvent.click(
      await screen.findByRole("button", { name: "Cancel subscription" })
    )
    await screen.findByText("Cancel at the end of this period?")
    expect(mock.cancel).not.toHaveBeenCalled()
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm cancellation" })
    )
    await waitFor(() =>
      expect(mock.cancel).toHaveBeenCalledWith({
        data: { workspaceId: "team", cancel: true },
      })
    )
    await waitFor(() =>
      expect(mock.success).toHaveBeenCalledWith(
        "Cancellation scheduled for the end of this billing period."
      )
    )
  })
})
