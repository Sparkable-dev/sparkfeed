import type {
  EntitlementPlan,
  WorkspaceAccessState,
} from "@/server/entitlements/types"

export interface WorkspaceAccessSnapshot {
  workspaceKey: string
  workspaceName: string
  plan: EntitlementPlan
  planLabel: string
  accessState: WorkspaceAccessState
  billingStatus: string
}

export type WorkspaceAccessNoticeKind =
  "plan_changed" | "billing_changed" | "access_restricted" | "access_restored"

export interface WorkspaceAccessNotice {
  kind: WorkspaceAccessNoticeKind
  previous: WorkspaceAccessSnapshot | null
  current: WorkspaceAccessSnapshot
}

export function workspaceAccessNotice(
  previous: WorkspaceAccessSnapshot | null,
  current: WorkspaceAccessSnapshot
): WorkspaceAccessNotice | null {
  if (!previous) {
    return current.accessState === "active"
      ? null
      : { kind: "access_restricted", previous, current }
  }

  if (previous.accessState !== current.accessState) {
    return {
      kind:
        current.accessState === "active"
          ? "access_restored"
          : "access_restricted",
      previous,
      current,
    }
  }

  if (previous.plan !== current.plan) {
    return { kind: "plan_changed", previous, current }
  }

  if (previous.billingStatus !== current.billingStatus) {
    return { kind: "billing_changed", previous, current }
  }

  return null
}
