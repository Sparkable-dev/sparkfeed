import { describe, expect, it } from "vitest"
import {
  organizationWorkspaceRef,
  personalWorkspaceName,
  personalWorkspaceRef,
  workspacePlanLabel,
  workspaceRefForSession,
} from "../workspaces"

describe("workspace contracts", () => {
  it("uses the account id for direct and invited personal workspaces", () => {
    expect(personalWorkspaceRef("direct-user")).toEqual({
      type: "personal",
      id: "direct-user",
    })
    expect(personalWorkspaceRef("invited-user")).toEqual({
      type: "personal",
      id: "invited-user",
    })
  })

  it("keeps organization workspaces distinct", () => {
    expect(organizationWorkspaceRef("org-1")).toEqual({
      type: "organization",
      id: "org-1",
    })
  })

  it("activates an accepted organization and falls back to personal access", () => {
    expect(workspaceRefForSession("invited-user", "org-1")).toEqual({
      type: "organization",
      id: "org-1",
    })
    expect(workspaceRefForSession("invited-user", null)).toEqual({
      type: "personal",
      id: "invited-user",
    })
  })

  it("uses the approved personal workspace display name", () => {
    expect(personalWorkspaceName("Sudu")).toBe("Sudu's workspace")
    expect(personalWorkspaceName("Tech Support")).toBe("Tech's workspace")
    expect(personalWorkspaceName("  ")).toBe("Personal workspace")
  })

  it("shows the resolved personal plan without claiming team billing", () => {
    expect(workspacePlanLabel("personal_plus", false)).toBe("Personal+")
    expect(workspacePlanLabel("free", false)).toBe("Free plan")
    expect(workspacePlanLabel(null, false)).toBe("Personal workspace")
    expect(workspacePlanLabel("pro", true)).toBe("Team workspace")
  })
})
