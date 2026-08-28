import { createServerFn } from "@tanstack/react-start"
import {
  canUserCreateWorkspace,
  readWorkspaceCreationPolicy,
  registrationDecision,
} from "@/server/community-policy"

/**
 * Returns whether registration is currently open.
 *
 * This mirrors the Better Auth user-create hook so the page can explain the
 * policy before a person submits the form. The auth hook remains authoritative.
 */
export const checkCanRegister = createServerFn({ method: "GET" })
  .validator((data: { email?: string } | undefined) => data ?? {})
  .handler(async ({ data }) => registrationDecision(data.email))

export const checkCanCreateWorkspace = createServerFn({
  method: "GET",
}).handler(async () => {
  const { auth } = await import("@/lib/auth")
  const { getRequestHeaders } = await import("@tanstack/react-start/server")
  const session = await auth.api.getSession({ headers: getRequestHeaders() })

  if (!session) {
    return { allowed: false, reason: "unauthenticated" as const }
  }

  const allowed = await canUserCreateWorkspace(session.user.id)
  return {
    allowed,
    reason: allowed
      ? ("allowed" as const)
      : (`workspace-creation-${readWorkspaceCreationPolicy()}` as const),
  }
})
