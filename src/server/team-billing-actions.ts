import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { and, eq, gte, sql } from "drizzle-orm"
import { sparkfeedEdition } from "./entitlements/config"
import { dodoClient } from "./billing/dodo-client"
import { readDodoBillingConfig, readTeamProducts } from "./billing/dodo-config"
import { teamPurchaseInput } from "./billing/team-policy"
import {
  applyQueuedTeamReduction,
  cancelTeamScheduledChange,
  changeTeamPlan,
  createPendingTeam,
  readTeamSubscription,
  reconcileTeam,
  refreshTeamLifecycle,
  setTeamCancellation,
  startTeamCheckout,
  teamPortal,
} from "./billing/team-subscriptions"
import {
  aiUsageRequests,
  creditLedger,
  member,
  session,
  teamBillingState,
  user,
} from "@/db/schema"
import { db } from "@/db/index"

async function billingActor() {
  if (
    sparkfeedEdition() !== "cloud" ||
    process.env.DEMO_MODE === "true" ||
    process.env.VITE_DEMO_MODE === "true"
  )
    throw new Error("Online team billing is only available in Sparkfeed Cloud.")
  const { auth } = await import("@/lib/auth")
  const { getRequestHeaders } = await import("@tanstack/react-start/server")
  const current = await auth.api.getSession({ headers: getRequestHeaders() })
  if (!current?.user.emailVerified)
    throw new Error("Sign in with a verified email to manage billing.")
  const [activeSession] = await db
    .select({ impersonatedBy: session.impersonatedBy })
    .from(session)
    .where(eq(session.id, current.session.id))
    .limit(1)
  if (activeSession?.impersonatedBy)
    throw new Error(
      "Billing changes are unavailable during a support session. Sign in as the workspace Owner."
    )
  const [account] = await db
    .select()
    .from(user)
    .where(eq(user.id, current.user.id))
    .limit(1)
  if (
    !account ||
    (account.banned && (!account.banExpires || account.banExpires > new Date()))
  )
    throw new Error("This account cannot manage billing.")
  return current.user.id
}

async function owner(id: string) {
  const actor = await billingActor()
  const [membership] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, id), eq(member.userId, actor)))
    .limit(1)
  if (membership?.role !== "owner")
    throw new Error("Only the workspace Owner can manage billing.")
  return actor
}

function config() {
  const value = readDodoBillingConfig()
  if (!value?.teamProducts)
    throw new Error("Team billing is not configured yet. Contact Sparkable.")
  return value
}

async function billingCall<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (error && typeof error === "object" && "status" in error) {
      const status = Number(error.status)
      console.error("[team-billing] Provider request failed", status)
      throw new Error(
        status === 409
          ? "A payment or plan change is already processing. Refresh billing before trying again."
          : "The billing provider could not complete this request. Refresh billing before retrying."
      )
    }
    throw error
  }
}

export const createPaidTeam = createServerFn({ method: "POST" })
  .validator(
    teamPurchaseInput.extend({
      name: z.string().trim().min(2).max(80),
      requestId: z.uuid(),
      upgradePersonal: z.boolean().default(false),
    })
  )
  .handler(async ({ data }) =>
    billingCall(async () => {
      const actor = await billingActor()
      config()
      return createPendingTeam(
        actor,
        data.name,
        data,
        data.requestId,
        data.upgradePersonal
      )
    })
  )

const teamId = z.object({ workspaceId: z.string().min(1) })
export const getTeamBillingSummary = createServerFn({ method: "GET" })
  .validator(teamId)
  .handler(async ({ data }) =>
    billingCall(async () => {
      await owner(data.workspaceId)
      let syncWarning: string | null = null
      const local = await readTeamSubscription(db, data.workspaceId)
      if (local.planKey === "pro" && readTeamProducts()) {
        try {
          await applyQueuedTeamReduction(
            data.workspaceId,
            dodoClient(),
            config()
          )
          await reconcileTeam(data.workspaceId, dodoClient(), config())
        } catch {
          syncWarning =
            "Payment status could not be refreshed. Your last confirmed plan is shown. Try Refresh billing."
        }
      }
      await refreshTeamLifecycle(data.workspaceId)
      const row = await readTeamSubscription(db, data.workspaceId)
      const [state] = await db
        .select()
        .from(teamBillingState)
        .where(eq(teamBillingState.workspaceId, data.workspaceId))
        .limit(1)
      const periodStart = row.currentPeriodStart ?? row.createdAt
      const [[credits], [usage]] = await Promise.all([
        db
          .select({
            available: sql<number>`greatest(coalesce(sum(${creditLedger.amount}), 0), 0)`,
          })
          .from(creditLedger)
          .where(
            and(
              eq(creditLedger.workspaceType, "organization"),
              eq(creditLedger.workspaceId, data.workspaceId)
            )
          ),
        db
          .select({
            credits: sql<number>`coalesce(sum(${aiUsageRequests.chargedCredits}), 0)`,
            costUsd: sql<number>`coalesce(sum(${aiUsageRequests.costUsd}), 0)`,
            requests: sql<number>`count(*)::int`,
          })
          .from(aiUsageRequests)
          .where(
            and(
              eq(aiUsageRequests.workspaceType, "organization"),
              eq(aiUsageRequests.workspaceId, data.workspaceId),
              gte(aiUsageRequests.startedAt, periodStart)
            )
          ),
      ])
      return {
        plan: row.planKey,
        status: row.subscriptionStatus,
        accessState: row.accessState,
        billingSource: row.billingSource,
        interval: row.billingInterval ?? state?.interval ?? "monthly",
        paidSeats: row.paidSeatQuantity,
        checkoutSeats: state?.seats ?? row.paidSeatQuantity,
        checkoutLocked: Boolean(
          state &&
          !row.dodoSubscriptionId &&
          (row.subscriptionStatus === "checkout_pending" ||
            row.billingSource === "manual")
        ),
        periodEnd: row.currentPeriodEnd,
        graceDeadline: row.failedPaymentGraceDeadline,
        scheduledSeats: row.scheduledSeatQuantity,
        scheduledAt: row.scheduledSeatEffectiveAt,
        scheduledInterval: state?.scheduledInterval ?? null,
        pendingSeatReduction: state?.pendingSeatReduction ?? null,
        portalAvailable: Boolean(row.dodoCustomerId),
        canCheckout:
          !["on_hold", "past_due", "expired"].includes(
            state?.providerStatus ?? ""
          ) &&
          (row.billingSource === "manual" ||
            row.subscriptionStatus === "checkout_pending" ||
            (row.subscriptionStatus === "canceled" &&
              row.accessState === "read_only")),
        syncWarning,
        paymentFailed: state?.providerStatus === "failed",
        pendingPlanChange: Boolean(state?.pendingPlanChange),
        sparkAiCreditsAvailable: Number(credits?.available ?? 0),
        sparkAiCreditsUsed: Number(usage?.credits ?? 0),
        sparkAiCostUsd: Number(usage?.costUsd ?? 0),
        sparkAiRequests: Number(usage?.requests ?? 0),
        checkoutUncertain: Boolean(
          state?.checkoutRequestedAt &&
          !state.checkoutUrl &&
          !row.dodoSubscriptionId
        ),
        upgradeStatus: state?.upgradeUserId
          ? state.contentMovedAt
            ? "complete"
            : row.currentPeriodStart
              ? "processing"
              : "awaiting_payment"
          : null,
      }
    })
  )

export const checkoutTeam = createServerFn({ method: "POST" })
  .validator(teamId.extend(teamPurchaseInput.shape))
  .handler(async ({ data }) =>
    billingCall(async () => {
      const actor = await owner(data.workspaceId)
      return startTeamCheckout(
        data.workspaceId,
        actor,
        data,
        dodoClient(),
        config()
      )
    })
  )

export const previewTeamChange = createServerFn({ method: "POST" })
  .validator(teamId.extend(teamPurchaseInput.shape))
  .handler(async ({ data }) =>
    billingCall(async () => {
      const actor = await owner(data.workspaceId)
      return changeTeamPlan(
        data.workspaceId,
        actor,
        data,
        true,
        dodoClient(),
        config()
      )
    })
  )

export const confirmTeamChange = createServerFn({ method: "POST" })
  .validator(
    teamId
      .extend(teamPurchaseInput.shape)
      .extend({ previewToken: z.string().length(64) })
  )
  .handler(async ({ data }) =>
    billingCall(async () => {
      const actor = await owner(data.workspaceId)
      return changeTeamPlan(
        data.workspaceId,
        actor,
        data,
        false,
        dodoClient(),
        config(),
        data.previewToken
      )
    })
  )

export const openTeamPortal = createServerFn({ method: "POST" })
  .validator(teamId)
  .handler(async ({ data }) =>
    billingCall(async () => {
      const actor = await owner(data.workspaceId)
      return teamPortal(data.workspaceId, actor, dodoClient())
    })
  )

export const cancelTeamPlan = createServerFn({ method: "POST" })
  .validator(teamId.extend({ cancel: z.boolean() }))
  .handler(async ({ data }) =>
    billingCall(async () => {
      const actor = await owner(data.workspaceId)
      await setTeamCancellation(
        data.workspaceId,
        actor,
        data.cancel,
        dodoClient(),
        config()
      )
      return { success: true }
    })
  )

export const cancelScheduledTeamChange = createServerFn({ method: "POST" })
  .validator(teamId)
  .handler(async ({ data }) =>
    billingCall(async () => {
      const actor = await owner(data.workspaceId)
      await cancelTeamScheduledChange(
        data.workspaceId,
        actor,
        dodoClient(),
        config()
      )
      return { success: true }
    })
  )
