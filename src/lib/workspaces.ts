import type { WorkspaceRef } from "@/server/entitlements/types"

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
  return clean ? `${clean}'s workspace` : "Personal workspace"
}
