import { and, asc, eq } from "drizzle-orm"
import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import {
  createPersonalCheckout,
  currentDodoBillingConfig,
} from "./billing/personal-checkout"
import { dodoClient } from "./billing/dodo-client"
import {
  repairFailedInitialPersonalCheckout,
  selectFreePersonalSources,
} from "./billing/personal-lifecycle"
import { reconcilePendingPersonalCheckout } from "./billing/personal-reconciliation"
import type {
  BillingInterval,
  BillingStatus,
  EntitlementPlan,
  WorkspaceAccessState,
} from "@/server/entitlements/types"
import { db } from "@/db/index"
import { feeds, user, workspaceSubscriptions } from "@/db/schema"
import {
  creditBalance,
  ensureCloudFreeAccount,
} from "@/server/entitlements/credits"
import { sparkfeedEdition } from "@/server/entitlements/config"
import { resolveEntitlements } from "@/server/entitlements/resolve"
import { personalWorkspaceRef } from "@/lib/workspaces"

export interface PersonalBillingSource {
  id: string
  name: string
  url: string
  active: boolean
}

export interface PersonalBillingSummary {
  plan: EntitlementPlan
  billingStatus: BillingStatus
  accessState: WorkspaceAccessState
  interval: BillingInterval | null
  currentPeriodEnd: string | null
  graceDeadline: string | null
  freeCredits: number
  paidCredits: number
  spendableCredits: number | null
  sourceLimit: number | null
  sources: Array<PersonalBillingSource>
  portalAvailable: boolean
}

async function billingSession() {
  const { auth } = await import("@/lib/auth")
  const { getRequestHeaders } = await import("@tanstack/react-start/server")
  const headers = getRequestHeaders()
  const session = await auth.api.getSession({ headers })
  if (!session) throw new Error("Sign in to manage billing.")
  return session
}

export const getPersonalBillingSummary = createServerFn({
  method: "GET",
}).handler(async (): Promise<PersonalBillingSummary> => {
  const session = await billingSession()
  const workspace = personalWorkspaceRef(session.user.id)

  if (sparkfeedEdition() === "community") {
    return {
      plan: "community",
      billingStatus: "not_applicable",
      accessState: "active",
      interval: null,
      currentPeriodEnd: null,
      graceDeadline: null,
      freeCredits: 0,
      paidCredits: 0,
      spendableCredits: null,
      sourceLimit: null,
      sources: [],
      portalAvailable: false,
    }
  }

  await ensureCloudFreeAccount(
    workspace,
    session.user.id,
    session.user.emailVerified
  )
  await repairFailedInitialPersonalCheckout(session.user.id)
  try {
    await reconcilePendingPersonalCheckout(
      session.user.id,
      dodoClient(),
      currentDodoBillingConfig()
    )
  } catch (error) {
    console.error(
      "[billing] Pending checkout reconciliation failed:",
      error instanceof Error ? error.message : "unknown error"
    )
  }
  const entitlements = await resolveEntitlements(workspace, {
    type: "session",
    userId: session.user.id,
    emailVerified: session.user.emailVerified,
    workspaceId: session.user.id,
    demo: false,
  })

  const [subscription] = await db
    .select()
    .from(workspaceSubscriptions)
    .where(
      and(
        eq(workspaceSubscriptions.workspaceType, "personal"),
        eq(workspaceSubscriptions.workspaceId, session.user.id)
      )
    )
    .limit(1)
  const sourceRows = await db
    .select({
      id: feeds.id,
      name: feeds.name,
      url: feeds.url,
      pausedAt: feeds.entitlementPausedAt,
    })
    .from(feeds)
    .where(and(eq(feeds.workspaceId, session.user.id), eq(feeds.kind, "page")))
    .orderBy(asc(feeds.createdAt), asc(feeds.id))
  const [account] = await db
    .select({ customerId: user.dodoCustomerId })
    .from(user)
    .where(eq(user.id, session.user.id))
    .limit(1)

  const freeCredits = await creditBalance(workspace, session.user.id, "free")
  const paidCredits = await creditBalance(workspace, session.user.id, "paid")

  return {
    plan: entitlements.plan,
    billingStatus: entitlements.billingStatus,
    accessState: entitlements.accessState,
    interval: subscription?.billingInterval ?? null,
    currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
    graceDeadline: subscription?.failedPaymentGraceDeadline ?? null,
    freeCredits,
    paidCredits,
    spendableCredits: entitlements.sparkAiCreditBalance,
    sourceLimit: entitlements.sourceUnitCapacity,
    sources: sourceRows.map((source) => ({
      id: source.id,
      name: source.name,
      url: source.url,
      active: source.pausedAt === null,
    })),
    portalAvailable: Boolean(
      account?.customerId && subscription?.dodoSubscriptionId
    ),
  }
})

export const startPersonalCheckout = createServerFn({ method: "POST" })
  .validator(z.object({ interval: z.enum(["monthly", "annual"]) }))
  .handler(async ({ data }) => {
    if (sparkfeedEdition() !== "cloud") {
      throw new Error("Community Edition does not use hosted billing.")
    }
    const session = await billingSession()
    if (!session.user.emailVerified) {
      throw new Error("Verify your email before starting checkout.")
    }

    return createPersonalCheckout(
      session.user.id,
      data.interval,
      dodoClient(),
      currentDodoBillingConfig()
    )
  })

export const updateFreePersonalSources = createServerFn({ method: "POST" })
  .validator(z.object({ sourceIds: z.array(z.string()).max(5) }))
  .handler(async ({ data }) => {
    if (sparkfeedEdition() !== "cloud") {
      throw new Error("This setting applies only to Sparkfeed Cloud.")
    }
    const session = await billingSession()
    const workspace = personalWorkspaceRef(session.user.id)
    const entitlements = await resolveEntitlements(workspace, {
      type: "session",
      userId: session.user.id,
      emailVerified: session.user.emailVerified,
      workspaceId: session.user.id,
      demo: false,
    })
    if (entitlements.plan !== "free") {
      throw new Error("Source selection is only required on the Free plan.")
    }
    await selectFreePersonalSources(session.user.id, data.sourceIds)
    return { success: true }
  })
