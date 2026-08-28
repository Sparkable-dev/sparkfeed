export type RegistrationReason =
  "open" | "first-setup" | "invited" | "invite-only" | "instance-limit"
export type WorkspaceCreationPolicy = "owner-only" | "all-users"

export const COMMUNITY_USER_LIMIT = 10

export interface RegistrationDecision {
  allowed: boolean
  reason: RegistrationReason
}

export function decideRegistration(input: {
  openRegistration: boolean
  userCount: number
  invited: boolean
}): RegistrationDecision {
  if (input.userCount >= COMMUNITY_USER_LIMIT) {
    return { allowed: false, reason: "instance-limit" }
  }
  if (input.openRegistration) return { allowed: true, reason: "open" }
  if (input.userCount === 0) return { allowed: true, reason: "first-setup" }
  if (input.invited) return { allowed: true, reason: "invited" }
  return { allowed: false, reason: "invite-only" }
}

export function readWorkspaceCreationPolicy(
  value = process.env.WORKSPACE_CREATION_POLICY
): WorkspaceCreationPolicy {
  return value === "all-users" ? "all-users" : "owner-only"
}

export function decideWorkspaceCreation(input: {
  policy: WorkspaceCreationPolicy
  isInstanceOwner: boolean
}): boolean {
  return input.policy === "all-users" || input.isInstanceOwner
}
