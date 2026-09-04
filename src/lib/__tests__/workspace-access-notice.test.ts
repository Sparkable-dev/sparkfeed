import { describe, expect, it } from "vitest"
import { workspaceAccessNotice } from "../workspace-access-notice"
import type { WorkspaceAccessSnapshot } from "../workspace-access-notice"

const active: WorkspaceAccessSnapshot = {
  workspaceKey: "organization:org-1:2026-09-04T10:00:00Z",
  workspaceName: "Research team",
  plan: "pro",
  planLabel: "Pro",
  accessState: "active",
  billingStatus: "active",
}

describe("workspace access notices", () => {
  it("does not interrupt the first healthy visit", () => {
    expect(workspaceAccessNotice(null, active)).toBeNull()
  })

  it("shows an initial suspension", () => {
    expect(
      workspaceAccessNotice(null, { ...active, accessState: "suspended" })?.kind
    ).toBe("access_restricted")
  })

  it("reports plan changes", () => {
    expect(
      workspaceAccessNotice(active, {
        ...active,
        plan: "enterprise",
        planLabel: "Enterprise",
      })?.kind
    ).toBe("plan_changed")
  })

  it("reports billing status changes while access remains active", () => {
    expect(
      workspaceAccessNotice(active, {
        ...active,
        billingStatus: "past_due",
      })?.kind
    ).toBe("billing_changed")
  })

  it("reports restrictions and restoration", () => {
    const suspended = { ...active, accessState: "suspended" as const }
    expect(workspaceAccessNotice(active, suspended)?.kind).toBe(
      "access_restricted"
    )
    expect(workspaceAccessNotice(suspended, active)?.kind).toBe(
      "access_restored"
    )
  })
})
