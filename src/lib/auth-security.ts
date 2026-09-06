import { admin } from "better-auth/plugins"
import { createAccessControl } from "better-auth/plugins/access"

const access = createAccessControl({ user: [], session: [] })
const customerRole = access.newRole({ user: [], session: [] })

/** Retain Better Auth's ban enforcement, without customer-admin permissions. */
export function customerAccountSecurity() {
  const plugin = admin({
    ac: access,
    roles: { user: customerRole, admin: customerRole },
    adminRoles: [],
  })
  // The plugin supplies account-ban/session hooks and schema only.
  // All staff commands enter through the signed service API or hosted connector.
  return { ...plugin, endpoints: {} }
}
