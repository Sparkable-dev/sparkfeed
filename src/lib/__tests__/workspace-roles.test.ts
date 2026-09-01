import { describe, expect, it } from "vitest"
import {
  WORKSPACE_ROLES,
  canManageBilling,
  canManageWorkspace,
  normalizeWorkspaceRole,
} from "../workspace-roles"

describe("workspace roles", () => {
  it("uses the approved Owner, Admin, and Editor roles", () => {
    expect(WORKSPACE_ROLES).toEqual(["owner", "admin", "editor"])
    expect(normalizeWorkspaceRole("member")).toBe("editor")
    expect(normalizeWorkspaceRole("unknown")).toBe("editor")
  })

  it("keeps billing owner-only", () => {
    expect(canManageBilling("owner")).toBe(true)
    expect(canManageBilling("admin")).toBe(false)
    expect(canManageBilling("editor")).toBe(false)
  })

  it("lets owners and admins manage workspace settings", () => {
    expect(canManageWorkspace("owner")).toBe(true)
    expect(canManageWorkspace("admin")).toBe(true)
    expect(canManageWorkspace("editor")).toBe(false)
  })
})
