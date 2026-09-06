import { eq } from "drizzle-orm"
import { sparkfeedEdition } from "./config"
import { creditBalance, ensureCloudFreeAccount } from "./credits"
import { readEffectiveSubscription } from "./effective"
import { grantWorkspaceAllowance } from "./allowances"
import type {
  EntitlementOverrides,
  PlanKey,
  Principal,
  ResolvedEntitlements,
  WorkspaceRef,
} from "./types"
import type { workspaceSubscriptions } from "@/db/schema"
import { user } from "@/db/schema"
import { db } from "@/db/index"
import { refreshPersonalSubscriptionLifecycle } from "@/server/billing/personal-lifecycle"

const COMMUNITY: ResolvedEntitlements = {
  plan: "community",
  billingStatus: "not_applicable",
  accessState: "active",
  seatCapacity: 10,
  sourceUnitCapacity: null,
  monthlySparkAiCredits: null,
  sparkAiCreditBalance: null,
  canCreateOrganizations: true,
  canManageInvitations: true,
  apiAccess: true,
  mcpAccess: true,
  managedAiAccess: true,
}

export function planSupportsWorkspace(
  plan: PlanKey,
  workspaceType: WorkspaceRef["type"]
): boolean {
  return workspaceType === "personal"
    ? plan === "free" || plan === "personal_plus"
    : plan === "pro" || plan === "enterprise"
}

function overridesFrom(
  row: typeof workspaceSubscriptions.$inferSelect
): EntitlementOverrides {
  return {
    seatLimit: row.overrideSeatLimit,
    monthlyAiCredits: row.overrideMonthlyAiCredits,
    sourceUnitLimit: row.overrideSourceUnitLimit,
    apiAccess: row.overrideApiAccess,
    mcpAccess: row.overrideMcpAccess,
  }
}

export async function resolveEntitlements(
  workspace: WorkspaceRef,
  principal: Principal
): Promise<ResolvedEntitlements> {
  if (sparkfeedEdition() === "community" || principal.demo) return COMMUNITY

  if (
    principal.type === "session" &&
    workspace.type === "personal" &&
    workspace.id === principal.userId
  ) {
    await ensureCloudFreeAccount(
      workspace,
      principal.userId,
      principal.emailVerified
    )
  }

  if (workspace.type === "personal") {
    await refreshPersonalSubscriptionLifecycle(workspace.id)
  }

  const row = await readEffectiveSubscription(db, workspace)
  let banned = false
  const accountId =
    principal.userId ?? (workspace.type === "personal" ? workspace.id : null)
  if (accountId) {
    const [account] = await db
      .select({ banned: user.banned, until: user.banExpires })
      .from(user)
      .where(eq(user.id, accountId))
      .limit(1)
    banned = Boolean(
      account?.banned && (!account.until || account.until > new Date())
    )
  }

  if (!row) {
    return {
      plan: "free",
      billingStatus: "free",
      accessState:
        !banned && workspace.type === "personal" ? "active" : "suspended",
      seatCapacity: 1,
      sourceUnitCapacity: 5,
      monthlySparkAiCredits: 0,
      sparkAiCreditBalance: 0,
      canCreateOrganizations: false,
      canManageInvitations: false,
      apiAccess: false,
      mcpAccess: false,
      managedAiAccess: false,
    }
  }

  if (!planSupportsWorkspace(row.planKey, workspace.type)) {
    return {
      plan: row.planKey,
      billingStatus: row.subscriptionStatus,
      accessState: "suspended",
      seatCapacity: 0,
      sourceUnitCapacity: 0,
      monthlySparkAiCredits: 0,
      sparkAiCreditBalance: 0,
      canCreateOrganizations: false,
      canManageInvitations: false,
      apiAccess: false,
      mcpAccess: false,
      managedAiAccess: false,
    }
  }

  const overrides = overridesFrom(row)
  const active = !banned && row.accessState === "active"
  if (active && principal.userId && row.planKey !== "free")
    await grantWorkspaceAllowance(workspace, principal.userId)
  const beneficiary = principal.userId
  const balance = beneficiary
    ? await creditBalance(
        workspace,
        beneficiary,
        row.planKey === "free" ? "free" : undefined
      )
    : 0

  const defaults = {
    free: {
      seats: 1,
      sources: 5,
      monthlyCredits: 0,
      api: false,
      mcp: false,
      invitations: false,
    },
    personal_plus: {
      seats: 1,
      sources: 50,
      monthlyCredits: 100,
      api: true,
      mcp: true,
      invitations: false,
    },
    pro: {
      seats: row.paidSeatQuantity,
      sources: row.paidSeatQuantity * 50,
      monthlyCredits: 200,
      api: true,
      mcp: true,
      invitations: true,
    },
    enterprise: {
      seats: null,
      sources: null,
      monthlyCredits: null,
      api: true,
      mcp: true,
      invitations: true,
    },
  }[row.planKey]

  const apiAccess = active && (overrides.apiAccess ?? defaults.api)
  const mcpAccess = active && (overrides.mcpAccess ?? defaults.mcp)

  return {
    plan: row.planKey,
    billingStatus: row.subscriptionStatus,
    accessState: banned ? "suspended" : row.accessState,
    seatCapacity: overrides.seatLimit ?? defaults.seats,
    sourceUnitCapacity: overrides.sourceUnitLimit ?? defaults.sources,
    monthlySparkAiCredits:
      overrides.monthlyAiCredits ?? defaults.monthlyCredits,
    sparkAiCreditBalance: balance,
    canCreateOrganizations: false,
    canManageInvitations: active && defaults.invitations,
    apiAccess,
    mcpAccess,
    managedAiAccess: active && balance > 0,
  }
}
