import { createAccessControl } from "better-auth/plugins/access"

export const WORKSPACE_ROLES = ["owner", "admin", "editor"] as const
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number]

export const workspaceStatements = {
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  team: ["create", "update", "delete"],
  ac: ["create", "read", "update", "delete"],
} as const

export const workspaceAccess = createAccessControl(workspaceStatements)

export const workspaceRoles = {
  owner: workspaceAccess.newRole({
    organization: ["update", "delete"],
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
    team: ["create", "update", "delete"],
    ac: ["create", "read", "update", "delete"],
  }),
  admin: workspaceAccess.newRole({
    organization: ["update"],
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
    team: ["create", "update", "delete"],
    ac: ["read"],
  }),
  editor: workspaceAccess.newRole({
    organization: [],
    member: [],
    invitation: [],
    team: [],
    ac: ["read"],
  }),
}

export function normalizeWorkspaceRole(role: string): WorkspaceRole {
  if (role === "owner" || role === "admin") return role
  return "editor"
}

export function canManageWorkspace(role: WorkspaceRole): boolean {
  return role === "owner" || role === "admin"
}

export function canManageBilling(role: WorkspaceRole): boolean {
  return role === "owner"
}
