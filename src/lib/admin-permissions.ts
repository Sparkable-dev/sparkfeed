import { createAccessControl } from "better-auth/plugins/access"

/**
 * Better Auth Admin ships destructive endpoints by default. Sparkfeed's launch
 * role deliberately grants only the operations in the approved control-plane
 * specification. The official create-admin CLI can still bootstrap the first
 * account server-side; no web session can create users or assign roles.
 */
export const platformAdminStatements = {
  user: [
    "create",
    "list",
    "set-role",
    "ban",
    "impersonate",
    "impersonate-admins",
    "delete",
    "set-password",
    "set-email",
    "get",
    "update",
  ],
  session: ["list", "revoke", "delete"],
} as const

export const platformAdminAccess = createAccessControl(platformAdminStatements)

export const platformAdminRole = platformAdminAccess.newRole({
  user: ["list", "get", "ban"],
  session: ["list", "revoke"],
})

export const regularUserRole = platformAdminAccess.newRole({
  user: [],
  session: [],
})

export const platformAdminRoles = {
  admin: platformAdminRole,
  user: regularUserRole,
}
