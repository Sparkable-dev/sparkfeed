import type { EntitlementPlan, WorkspaceRef } from "@/server/entitlements/types"

export function personalWorkspaceRef(userId: string): WorkspaceRef {
  return { type: "personal", id: userId }
}

export function organizationWorkspaceRef(organizationId: string): WorkspaceRef {
  return { type: "organization", id: organizationId }
}

export function workspaceRefForSession(
  userId: string,
  activeOrganizationId: string | null | undefined
): WorkspaceRef {
  return activeOrganizationId
    ? organizationWorkspaceRef(activeOrganizationId)
    : personalWorkspaceRef(userId)
}

export function personalWorkspaceName(name: string | null | undefined): string {
  const clean = name?.trim()
  const firstName = clean?.split(/\s+/)[0]
  return firstName ? `${firstName}'s workspace` : "Personal workspace"
}

export function workspacePlanLabel(
  plan: EntitlementPlan | null,
  organization: boolean
): string {
  if (organization && plan === "community") return "Community Edition"
  if (organization && plan === "pro") return "Pro"
  if (organization && plan === "enterprise") return "Enterprise"
  if (organization) return "Team workspace"
  if (plan === "personal_plus") return "Personal+"
  if (plan === "community") return "Community Edition"
  if (plan === "pro") return "Pro plan"
  if (plan === "enterprise") return "Enterprise"
  if (plan === "free") return "Free plan"
  return "Personal workspace"
}
