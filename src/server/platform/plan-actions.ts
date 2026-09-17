import { and, eq } from "drizzle-orm"
import { z } from "zod"
import { workspaceInput } from "./contracts"
import { PlatformRequestError } from "./assertion"
import { changeWorkspaceOverride } from "./overrides"
import { db } from "@/db/index"
import { member, user, workspaceSubscriptions } from "@/db/schema"
import {
  activeOverride,
  effectiveSubscription,
  readWorkspaceOverride,
} from "@/server/entitlements/effective"
import { grantWorkspaceAllowance } from "@/server/entitlements/allowances"
import { ensureCloudFreeAccount } from "@/server/entitlements/credits"
import { sparkAiPlanPolicy } from "@/server/entitlements/plan-policy"
import { syncEffectivePersonalSources } from "@/server/billing/personal-lifecycle"

const planInput = workspaceInput.extend({
  action: z.literal("change_plan"),
  planKey: z.enum(["free", "personal_plus", "pro", "enterprise"]).nullable(),
  seats: z.number().int().min(1).max(10000).optional(),
  expectedRevision: z.number().int().nonnegative(),
  reason: z.string().trim().min(1).max(500),
})
/** A small operator command; provider subscriptions and customer charges remain untouched. */
export async function changePlan(
  raw: unknown,
  actor: { userId: string; email: string }
) {
  const input = planInput.parse(raw),
    workspace = { type: input.workspaceType, id: input.workspaceId }
  if (
    input.planKey &&
    (workspace.type === "personal"
      ? !["free", "personal_plus"].includes(input.planKey)
      : !["pro", "enterprise"].includes(input.planKey))
  )
    throw new PlatformRequestError(
      400,
      "Choose a plan for this workspace type. Personal workspaces cannot become teams through a plan change."
    )
  const [base] = await db
    .select()
    .from(workspaceSubscriptions)
    .where(
      and(
        eq(workspaceSubscriptions.workspaceType, workspace.type),
        eq(workspaceSubscriptions.workspaceId, workspace.id)
      )
    )
    .limit(1)
  const previous = await readWorkspaceOverride(db, workspace),
    current = activeOverride(previous)
  const effective = base
    ? effectiveSubscription(base, previous)
    : {
        planKey: workspace.type === "personal" ? "free" : "pro",
        overrideSeatLimit: null,
        paidSeatQuantity: input.seats ?? 1,
        overrideMonthlyAiCredits: null,
      }
  const samePlan = input.planKey === effective.planKey
  const result = await changeWorkspaceOverride(
    {
      action: "set_override",
      ...workspaceToInput(workspace),
      planKey: input.planKey,
      accessRestriction: current?.accessRestriction ?? null,
      seatLimit: input.planKey
        ? workspace.type === "personal"
          ? 1
          : (input.seats ??
            effective.overrideSeatLimit ??
            effective.paidSeatQuantity)
        : null,
      monthlyAiCredits:
        input.planKey === "enterprise"
          ? (effective.overrideMonthlyAiCredits ??
            (effective.planKey === "pro"
              ? sparkAiPlanPolicy("pro").monthlyCredits
              : 0))
          : samePlan
            ? (current?.monthlyAiCredits ?? null)
            : null,
      sourceUnitLimit: samePlan ? (current?.sourceUnitLimit ?? null) : null,
      apiAccess: samePlan ? (current?.apiAccess ?? null) : null,
      mcpAccess: samePlan ? (current?.mcpAccess ?? null) : null,
      expiresAt: null,
      expectedRevision: input.expectedRevision,
      reason: input.reason,
    },
    actor,
    { auditAction: "change_plan", initializeMissing: true }
  )
  if (workspace.type === "personal") {
    const [owner] = await db
      .select({ id: user.id, verified: user.emailVerified })
      .from(user)
      .where(eq(user.id, workspace.id))
      .limit(1)
    if (owner) await ensureCloudFreeAccount(workspace, owner.id, owner.verified)
    await syncEffectivePersonalSources(workspace.id)
    await grantWorkspaceAllowance(workspace, workspace.id)
  } else {
    const people = await db
      .select({ id: member.userId })
      .from(member)
      .where(eq(member.organizationId, workspace.id))
      .limit(100)
    for (const person of people)
      await grantWorkspaceAllowance(workspace, person.id)
  }
  return result
}
function workspaceToInput(workspace: {
  type: "personal" | "organization"
  id: string
}) {
  return { workspaceType: workspace.type, workspaceId: workspace.id }
}
