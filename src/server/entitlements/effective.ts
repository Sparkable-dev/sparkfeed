import { and, eq } from "drizzle-orm"
import type { WorkspaceRef } from "./types"
import type { Database } from "@/db/client"
import { workspaceOverrides, workspaceSubscriptions } from "@/db/schema"

export type Subscription = typeof workspaceSubscriptions.$inferSelect
export type WorkspaceOverride = typeof workspaceOverrides.$inferSelect

export function activeOverride(
  value: WorkspaceOverride | null,
  at = new Date()
) {
  return value && (!value.expiresAt || new Date(value.expiresAt) > at)
    ? value
    : null
}

/** Pure composition: never writes provider state or changes workspace identity. */
export function effectiveSubscription(
  base: Subscription,
  value: WorkspaceOverride | null,
  at = new Date()
): Subscription {
  const override = activeOverride(value, at)
  if (!override) return base
  const samePlan = !override.planKey || override.planKey === base.planKey
  return {
    ...base,
    planKey: override.planKey ?? base.planKey,
    accessState:
      override.accessRestriction ??
      (override.planKey ? "active" : base.accessState),
    overrideSeatLimit:
      override.seatLimit ?? (samePlan ? base.overrideSeatLimit : null),
    overrideMonthlyAiCredits:
      override.monthlyAiCredits ??
      (samePlan ? base.overrideMonthlyAiCredits : null),
    overrideSourceUnitLimit:
      override.sourceUnitLimit ??
      (samePlan ? base.overrideSourceUnitLimit : null),
    overrideApiAccess:
      override.apiAccess ?? (samePlan ? base.overrideApiAccess : null),
    overrideMcpAccess:
      override.mcpAccess ?? (samePlan ? base.overrideMcpAccess : null),
  }
}

export async function readWorkspaceOverride(
  database: Pick<Database, "select">,
  workspace: WorkspaceRef
) {
  const [row] = await database
    .select()
    .from(workspaceOverrides)
    .where(
      and(
        eq(workspaceOverrides.workspaceType, workspace.type),
        eq(workspaceOverrides.workspaceId, workspace.id)
      )
    )
    .limit(1)
  return row ?? null
}

export async function readEffectiveSubscription(
  database: Pick<Database, "select">,
  workspace: WorkspaceRef,
  at = new Date(),
  lock = false
) {
  const query = database
    .select()
    .from(workspaceSubscriptions)
    .where(
      and(
        eq(workspaceSubscriptions.workspaceType, workspace.type),
        eq(workspaceSubscriptions.workspaceId, workspace.id)
      )
    )
  if (lock && typeof query.for === "function") query.for("update")
  const [base] = await query.limit(1)
  if (!base) return null
  return effectiveSubscription(
    base,
    await readWorkspaceOverride(database, workspace),
    at
  )
}
