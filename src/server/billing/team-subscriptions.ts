import { createHash, randomUUID } from "node:crypto"
import { and, asc, eq, gt, inArray } from "drizzle-orm"
import {
  teamCart,
  teamLifecycle,
  teamPurchaseFromProvider,
  teamPurchaseInput,
} from "./team-policy"
import type DodoPayments from "dodopayments"
import type { Subscription } from "dodopayments/resources/subscriptions"
import type { Database } from "@/db/client"
import type { DodoBillingConfig } from "./dodo-config"
import type { TeamPurchase } from "./team-policy"
import { db } from "@/db/index"
import { readEffectiveSubscription } from "@/server/entitlements/effective"
import {
  feeds,
  invitation,
  member,
  organization,
  teamBillingState,
  user,
  workspaceSubscriptions,
} from "@/db/schema"

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0]
const whereTeam = (id: string) =>
  and(
    eq(workspaceSubscriptions.workspaceType, "organization"),
    eq(workspaceSubscriptions.workspaceId, id)
  )

export async function lockTeam(tx: Tx, id: string, ownerId?: string) {
  const query = tx.select().from(organization).where(eq(organization.id, id))
  if (typeof query.for === "function") query.for("update")
  const [org] = await query.limit(1)
  if (!org) throw new Error("Workspace not found.")
  if (ownerId) {
    const [owner] = await tx
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, id), eq(member.userId, ownerId)))
      .limit(1)
    if (owner?.role !== "owner")
      throw new Error("Only the workspace Owner can manage billing.")
  }
  return org
}

export async function teamOccupiedSeats(
  database: Pick<Database, "select">,
  id: string
) {
  const people = await database
    .select({ email: user.email })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, id))
  const invites = await database
    .select({ email: invitation.email })
    .from(invitation)
    .where(
      and(
        eq(invitation.organizationId, id),
        eq(invitation.status, "pending"),
        gt(invitation.expiresAt, new Date())
      )
    )
  const accepted = new Set(people.map((p) => p.email.toLowerCase()))
  return (
    people.length +
    new Set(
      invites
        .map((i) => i.email.toLowerCase())
        .filter((email) => !accepted.has(email))
    ).size
  )
}

export async function readTeamSubscription(
  database: Pick<Database, "select">,
  id: string
) {
  const [row] = await database
    .select()
    .from(workspaceSubscriptions)
    .where(whereTeam(id))
    .limit(1)
  if (!row) throw new Error("Workspace has no billing record.")
  return row
}

export async function createPendingTeam(
  ownerId: string,
  name: string,
  purchase: TeamPurchase,
  requestId: string
) {
  const parsed = teamPurchaseInput.parse(purchase)
  // Client UUID is only an idempotency token. It cannot select another owner's workspace.
  const id = `team-${createHash("sha256").update(`${ownerId}:${requestId}`).digest("hex").slice(0, 32)}`
  return db.transaction(async (tx) => {
    await tx
      .insert(organization)
      .values({ id, name, slug: id })
      .onConflictDoNothing()
    await lockTeam(tx, id)
    const [existing] = await tx
      .select()
      .from(teamBillingState)
      .where(eq(teamBillingState.workspaceId, id))
      .limit(1)
    if (!existing) {
      await tx.insert(workspaceSubscriptions).values({
        workspaceType: "organization",
        workspaceId: id,
        planKey: "pro",
        billingSource: "dodo",
        subscriptionStatus: "checkout_pending",
        accessState: "read_only",
        paidSeatQuantity: 1,
      })
      await tx.insert(member).values({
        id: randomUUID(),
        organizationId: id,
        userId: ownerId,
        role: "owner",
      })
      await tx
        .insert(teamBillingState)
        .values({ workspaceId: id, attemptId: randomUUID(), ...parsed })
    }
    await lockTeam(tx, id, ownerId)
    return { id, slug: id }
  })
}

/** Always use a freshly retrieved provider subscription, including for webhooks. */
export async function syncTeamSubscription(
  remote: Subscription,
  config: DodoBillingConfig,
  observedAt = new Date()
) {
  const metadata = remote.metadata
  if (
    metadata.billingSubjectType !== "organization" ||
    metadata.environment !== config.environment ||
    typeof metadata.billingSubjectId !== "string" ||
    !metadata.billingSubjectId
  )
    throw new Error(
      "Team subscription metadata does not match this environment."
    )
  const id = metadata.billingSubjectId
  const purchase = teamPurchaseFromProvider(config, remote)
  return db.transaction(async (tx) => {
    const [exists] = await tx
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, id))
      .limit(1)
    if (!exists) return // Late delivery after an explicitly deleted workspace.
    await lockTeam(tx, id)
    const local = await readTeamSubscription(tx, id)
    const [state] = await tx
      .select()
      .from(teamBillingState)
      .where(eq(teamBillingState.workspaceId, id))
      .limit(1)
    if (
      !state ||
      local.planKey !== "pro" ||
      local.dodoCustomerId !== remote.customer.customer_id
    )
      throw new Error("Dodo customer does not match the team workspace.")
    if (metadata.checkoutAttemptId !== state.attemptId) return
    if (
      local.dodoSubscriptionId &&
      local.dodoSubscriptionId !== remote.subscription_id
    )
      throw new Error("Dodo subscription does not match the team workspace.")
    if (
      local.providerEventAt &&
      Date.parse(local.providerEventAt) > observedAt.getTime()
    )
      return
    if (local.billingSource === "manual" && remote.status !== "active") return
    const lifecycle = teamLifecycle(remote, local, observedAt)
    const scheduled = remote.scheduled_change
      ? teamPurchaseFromProvider(config, remote.scheduled_change)
      : null
    const occupied = await teamOccupiedSeats(tx, id)
    const paid = remote.status === "active" || Boolean(local.currentPeriodStart)
    if (
      paid &&
      (!Number.isFinite(Date.parse(remote.previous_billing_date)) ||
        !Number.isFinite(Date.parse(remote.next_billing_date)))
    )
      throw new Error("Dodo returned invalid subscription dates.")
    await tx
      .update(workspaceSubscriptions)
      .set({
        ...lifecycle,
        planKey: "pro",
        billingSource: "dodo",
        billingInterval: purchase.interval,
        ...(local.billingSource === "manual"
          ? {
              overrideSeatLimit: null,
              overrideMonthlyAiCredits: null,
              overrideSourceUnitLimit: null,
              overrideApiAccess: null,
              overrideMcpAccess: null,
            }
          : {}),
        paidSeatQuantity: paid ? purchase.seats : 1,
        accessState:
          occupied > purchase.seats ? "read_only" : lifecycle.accessState,
        dodoSubscriptionId: remote.subscription_id,
        productKey: `pro-seat-${purchase.interval}`,
        currentPeriodStart: paid ? remote.previous_billing_date : null,
        currentPeriodEnd: paid ? remote.next_billing_date : null,
        scheduledSeatQuantity: scheduled?.seats ?? null,
        scheduledSeatEffectiveAt: remote.scheduled_change?.effective_at ?? null,
        providerEventAt: observedAt.toISOString(),
        updatedAt: observedAt.toISOString(),
      })
      .where(whereTeam(id))
    const effective = await readEffectiveSubscription(tx, {
      type: "organization",
      id,
    })
    if (
      effective?.accessState === "active" &&
      (effective.planKey === "pro" || effective.planKey === "enterprise")
    ) {
      const capacity =
        effective.overrideSourceUnitLimit ??
        (effective.planKey === "pro" ? effective.paidSeatQuantity * 50 : null)
      const pages = await tx
        .select({ id: feeds.id, pausedAt: feeds.entitlementPausedAt })
        .from(feeds)
        .where(and(eq(feeds.workspaceId, id), eq(feeds.kind, "page")))
        .orderBy(asc(feeds.createdAt), asc(feeds.id))
      const allowed = pages
        .slice(0, capacity ?? pages.length)
        .filter((page) => page.pausedAt)
        .map((page) => page.id)
      const excess =
        capacity === null
          ? []
          : pages
              .slice(capacity)
              .filter((page) => !page.pausedAt)
              .map((page) => page.id)
      if (allowed.length)
        await tx
          .update(feeds)
          .set({ entitlementPausedAt: null })
          .where(inArray(feeds.id, allowed))
      if (excess.length)
        await tx
          .update(feeds)
          .set({ entitlementPausedAt: observedAt.toISOString() })
          .where(inArray(feeds.id, excess))
    }
    await tx
      .update(teamBillingState)
      .set({
        lastSyncedAt: observedAt.toISOString(),
        scheduledInterval: scheduled?.interval ?? null,
      })
      .where(eq(teamBillingState.workspaceId, id))
  })
}

export async function reconcileTeam(
  id: string,
  client: DodoPayments,
  config: DodoBillingConfig
) {
  const local = await readTeamSubscription(db, id)
  if (local.planKey !== "pro" || !local.dodoCustomerId) return false
  let subscriptionId = local.dodoSubscriptionId
  if (!subscriptionId) {
    const [state] = await db
      .select()
      .from(teamBillingState)
      .where(eq(teamBillingState.workspaceId, id))
      .limit(1)
    if (!state) return false
    for await (const sub of client.subscriptions.list({
      customer_id: local.dodoCustomerId,
    })) {
      if (
        sub.metadata.billingSubjectId === id &&
        sub.metadata.checkoutAttemptId === state.attemptId &&
        sub.metadata.environment === config.environment
      ) {
        subscriptionId = sub.subscription_id
        break
      }
    }
  }
  if (!subscriptionId) return false
  const observedAt = new Date()
  const remote = await client.subscriptions.retrieve(subscriptionId)
  await syncTeamSubscription(remote, config, observedAt)
  return true
}

export async function startTeamCheckout(
  id: string,
  ownerId: string,
  purchase: TeamPurchase,
  client: DodoPayments,
  config: DodoBillingConfig
) {
  teamCart(config, purchase)
  await reconcileTeam(id, client, config)
  // Attempt identity commits before calling Dodo; a lost response can be safely retried.
  await db.transaction(async (tx) => {
    const org = await lockTeam(tx, id, ownerId)
    const local = await readTeamSubscription(tx, id)
    if (local.planKey !== "pro")
      throw new Error(
        "Sparkable manages this plan. Request a plan change first."
      )
    let [state] = await tx
      .select()
      .from(teamBillingState)
      .where(eq(teamBillingState.workspaceId, id))
      .limit(1)
    if (
      !state &&
      local.billingSource === "manual" &&
      !local.dodoSubscriptionId
    ) {
      if (purchase.seats < (await teamOccupiedSeats(tx, id)))
        throw new Error(
          "Choose enough seats for your members and pending invitations."
        )
      ;[state] = await tx
        .insert(teamBillingState)
        .values({ workspaceId: id, attemptId: randomUUID(), ...purchase })
        .returning()
    }
    if (!state)
      throw new Error(
        "Contact Sparkable to migrate this workspace to online billing."
      )
    if (local.dodoSubscriptionId) {
      const remote = await client.subscriptions.retrieve(
        local.dodoSubscriptionId
      )
      const unpaid =
        !local.currentPeriodStart &&
        (remote.status === "failed" || remote.status === "on_hold")
      if (!["cancelled", "expired"].includes(remote.status) && !unpaid)
        throw new Error(
          "This team already has a subscription. Use Manage billing or change its seats."
        )
      if (unpaid)
        await client.subscriptions.update(remote.subscription_id, {
          status: "cancelled",
        })
      await tx
        .update(teamBillingState)
        .set({
          attemptId: randomUUID(),
          checkoutSessionId: null,
          checkoutUrl: null,
          ...purchase,
        })
        .where(eq(teamBillingState.workspaceId, id))
      await tx
        .update(workspaceSubscriptions)
        .set({
          dodoSubscriptionId: null,
          subscriptionStatus: "checkout_pending",
          accessState: "read_only",
          currentPeriodStart: null,
          currentPeriodEnd: null,
          providerEventAt: null,
        })
        .where(whereTeam(id))
    } else if (
      state.interval !== purchase.interval ||
      state.seats !== purchase.seats
    ) {
      throw new Error(
        "Resume the existing checkout first. You can change the plan after activation."
      )
    }
    if (!local.dodoCustomerId) {
      const [account] = await tx
        .select()
        .from(user)
        .where(eq(user.id, ownerId))
        .limit(1)
      if (!account?.emailVerified)
        throw new Error("Verify your email before checkout.")
      const customer = await client.customers.create(
        {
          email: account.email,
          name: org.name,
          metadata: {
            billingSubjectType: "organization",
            billingSubjectId: id,
            environment: config.environment,
          },
        },
        { idempotencyKey: `organization:${config.environment}:${id}` }
      )
      await tx
        .update(workspaceSubscriptions)
        .set({ dodoCustomerId: customer.customer_id })
        .where(whereTeam(id))
    }
  })
  return db.transaction(async (tx) => {
    const org = await lockTeam(tx, id, ownerId)
    const local = await readTeamSubscription(tx, id)
    const [state] = await tx
      .select()
      .from(teamBillingState)
      .where(eq(teamBillingState.workspaceId, id))
      .limit(1)
    if (!state || !local.dodoCustomerId)
      throw new Error("Checkout could not be prepared.")
    if (
      local.subscriptionStatus !== "checkout_pending" &&
      local.billingSource !== "manual"
    )
      throw new Error("Subscription already activated. Refresh billing.")
    if (state.checkoutUrl)
      return { checkoutUrl: state.checkoutUrl, slug: org.slug }
    const result = await client.checkoutSessions.create(
      {
        product_cart: [
          teamCart(config, { interval: state.interval, seats: state.seats }),
        ],
        customer: { customer_id: local.dodoCustomerId },
        return_url: `${config.appUrl}/settings/workspaces/${encodeURIComponent(org.slug)}?section=billing`,
        cancel_url: `${config.appUrl}/settings/workspaces/${encodeURIComponent(org.slug)}?section=billing`,
        billing_currency: "USD",
        metadata: {
          billingSubjectType: "organization",
          billingSubjectId: id,
          environment: config.environment,
          checkoutAttemptId: state.attemptId,
        },
        feature_flags: {
          allow_customer_editing_email: false,
          allow_customer_editing_name: false,
          always_create_new_customer: false,
          redirect_immediately: true,
        },
      },
      { idempotencyKey: `team-checkout:${state.attemptId}` }
    )
    if (!result.checkout_url)
      throw new Error("Dodo did not return a checkout link. Please retry.")
    await tx
      .update(teamBillingState)
      .set({
        checkoutSessionId: result.session_id,
        checkoutUrl: result.checkout_url,
      })
      .where(eq(teamBillingState.workspaceId, id))
    return { checkoutUrl: result.checkout_url, slug: org.slug }
  })
}

export function teamChangeParams(
  config: DodoBillingConfig,
  remote: Subscription,
  purchase: TeamPurchase
) {
  const current = teamPurchaseFromProvider(config, remote)
  return {
    ...teamCart(config, purchase),
    effective_at:
      purchase.seats < current.seats || purchase.interval !== current.interval
        ? ("next_billing_date" as const)
        : ("immediately" as const),
    proration_billing_mode:
      purchase.seats < current.seats || purchase.interval !== current.interval
        ? ("do_not_bill" as const)
        : ("prorated_immediately" as const),
    on_payment_failure: "prevent_change" as const,
    cancel_scheduled_change_plan: Boolean(remote.scheduled_change),
  }
}

export async function changeTeamPlan(
  id: string,
  ownerId: string,
  purchase: TeamPurchase,
  previewOnly: boolean,
  client: DodoPayments,
  config: DodoBillingConfig,
  expectedPreview?: string
) {
  const result = await db.transaction(async (tx) => {
    await lockTeam(tx, id, ownerId)
    const local = await readTeamSubscription(tx, id)
    if (local.billingSource !== "dodo" || !local.dodoSubscriptionId)
      throw new Error("No online team subscription exists.")
    if (purchase.seats < (await teamOccupiedSeats(tx, id)))
      throw new Error(
        "Remove members or pending invitations before reducing seats."
      )
    const remote = await client.subscriptions.retrieve(local.dodoSubscriptionId)
    if (remote.status !== "active" || remote.cancel_at_next_billing_date)
      throw new Error("Restore your subscription before changing its plan.")
    const current = teamPurchaseFromProvider(config, remote)
    if (
      current.seats === purchase.seats &&
      current.interval === purchase.interval &&
      !remote.scheduled_change
    )
      throw new Error("This is already your current plan.")
    const params = teamChangeParams(config, remote, purchase)
    const preview = await client.subscriptions.previewChangePlan(
      remote.subscription_id,
      params
    )
    // Bind confirmation to provider totals and current subscription, not browser-supplied prices.
    const summary = preview.immediate_charge.summary
    const token = createHash("sha256")
      .update(
        JSON.stringify({
          id: remote.subscription_id,
          params,
          current,
          period: remote.next_billing_date,
          summary,
        })
      )
      .digest("hex")
    const quote = {
      amount: summary.total_amount,
      currency: summary.currency,
      nextBillingDate: preview.new_plan.next_billing_date,
      effectiveAt:
        params.effective_at === "next_billing_date"
          ? remote.next_billing_date
          : preview.immediate_charge.effective_at,
    }
    if (previewOnly)
      return {
        quote,
        token,
        scheduled: params.effective_at === "next_billing_date",
      }
    if (token !== expectedPreview)
      throw new Error(
        "The billing estimate changed. Review the updated price before confirming."
      )
    await client.subscriptions.changePlan(remote.subscription_id, params, {
      idempotencyKey: `team-change:${token}`,
    })
    await tx
      .update(teamBillingState)
      .set({ pendingSeatReduction: null })
      .where(eq(teamBillingState.workspaceId, id))
    return {
      quote,
      token,
      scheduled: params.effective_at === "next_billing_date",
    }
  })
  if (!previewOnly) await reconcileTeam(id, client, config)
  return result
}

/** Grace/cancellation enforcement also works during a provider outage. */
export async function refreshTeamLifecycle(id: string, now = new Date()) {
  const [row] = await db
    .select()
    .from(workspaceSubscriptions)
    .where(whereTeam(id))
    .limit(1)
  if (!row || row.billingSource !== "dodo") return
  const cutoff =
    row.subscriptionStatus === "past_due"
      ? row.failedPaymentGraceDeadline
      : row.subscriptionStatus === "canceled"
        ? row.currentPeriodEnd
        : null
  if (cutoff && Date.parse(cutoff) <= now.getTime()) {
    await db
      .update(workspaceSubscriptions)
      .set({ accessState: "read_only" })
      .where(
        and(whereTeam(id), eq(workspaceSubscriptions.updatedAt, row.updatedAt))
      )
  }
}

export async function teamPortal(
  id: string,
  ownerId: string,
  client: DodoPayments
) {
  return db.transaction(async (tx) => {
    await lockTeam(tx, id, ownerId)
    const local = await readTeamSubscription(tx, id)
    if (local.billingSource !== "dodo" || !local.dodoCustomerId)
      throw new Error("No online billing account exists.")
    return client.customers.customerPortal.create(local.dodoCustomerId, {
      send_email: false,
    })
  })
}

export async function setTeamCancellation(
  id: string,
  ownerId: string,
  cancel: boolean,
  client: DodoPayments,
  config: DodoBillingConfig
) {
  await db.transaction(async (tx) => {
    await lockTeam(tx, id, ownerId)
    const local = await readTeamSubscription(tx, id)
    if (local.billingSource !== "dodo" || !local.dodoSubscriptionId)
      throw new Error("No online subscription exists.")
    const current = await client.subscriptions.retrieve(
      local.dodoSubscriptionId
    )
    if (current.status === "cancelled" || current.status === "expired")
      throw new Error(
        "This subscription has ended. Start a new checkout to reactivate your team."
      )
    await client.subscriptions.update(local.dodoSubscriptionId, {
      cancel_at_next_billing_date: cancel,
    })
  })
  await reconcileTeam(id, client, config)
}

export async function cancelTeamScheduledChange(
  id: string,
  ownerId: string | undefined,
  client: DodoPayments,
  config: DodoBillingConfig
) {
  await db.transaction(async (tx) => {
    await lockTeam(tx, id, ownerId)
    const local = await readTeamSubscription(tx, id)
    if (local.billingSource !== "dodo" || !local.dodoSubscriptionId) return
    const remote = await client.subscriptions.retrieve(local.dodoSubscriptionId)
    if (remote.scheduled_change)
      await client.subscriptions.cancelChangePlan(remote.subscription_id)
    await tx
      .update(teamBillingState)
      .set({ pendingSeatReduction: null })
      .where(eq(teamBillingState.workspaceId, id))
  })
  await reconcileTeam(id, client, config)
}

/** Save the reduction intent even when Dodo is temporarily unavailable. */
export async function queueTeamSeatReduction(id: string) {
  await db.transaction(async (tx) => {
    await lockTeam(tx, id)
    const local = await readTeamSubscription(tx, id)
    if (local.billingSource !== "dodo" || local.subscriptionStatus !== "active")
      return
    const [state] = await tx
      .select()
      .from(teamBillingState)
      .where(eq(teamBillingState.workspaceId, id))
      .limit(1)
    if (!state) return
    const target = Math.max(
      1,
      await teamOccupiedSeats(tx, id),
      (state.pendingSeatReduction ??
        local.scheduledSeatQuantity ??
        local.paidSeatQuantity) - 1
    )
    if (target < local.paidSeatQuantity)
      await tx
        .update(teamBillingState)
        .set({ pendingSeatReduction: target })
        .where(eq(teamBillingState.workspaceId, id))
  })
}

export async function applyQueuedTeamReduction(
  id: string,
  client: DodoPayments,
  config: DodoBillingConfig
) {
  await db.transaction(async (tx) => {
    await lockTeam(tx, id)
    const local = await readTeamSubscription(tx, id)
    if (local.billingSource !== "dodo" || !local.dodoSubscriptionId) return
    const [state] = await tx
      .select()
      .from(teamBillingState)
      .where(eq(teamBillingState.workspaceId, id))
      .limit(1)
    if (!state?.pendingSeatReduction) return
    const remote = await client.subscriptions.retrieve(local.dodoSubscriptionId)
    if (remote.status !== "active" || remote.cancel_at_next_billing_date) return
    const target = Math.max(
      state.pendingSeatReduction,
      await teamOccupiedSeats(tx, id)
    )
    const current = teamPurchaseFromProvider(config, remote)
    if (target < current.seats) {
      const interval = remote.scheduled_change
        ? teamPurchaseFromProvider(config, remote.scheduled_change).interval
        : current.interval
      await client.subscriptions.changePlan(
        remote.subscription_id,
        {
          ...teamCart(config, { seats: target, interval }),
          effective_at: "next_billing_date",
          proration_billing_mode: "do_not_bill",
          on_payment_failure: "prevent_change",
          cancel_scheduled_change_plan: Boolean(remote.scheduled_change),
        },
        {
          idempotencyKey: `team-reduce:${remote.subscription_id}:${remote.next_billing_date}:${target}:${interval}`,
        }
      )
    }
    await tx
      .update(teamBillingState)
      .set({ pendingSeatReduction: null })
      .where(eq(teamBillingState.workspaceId, id))
  })
}

/** Cancel a queued reduction before a new invitation reuses the paid capacity. */
export async function reserveTeamSeat(id: string) {
  const { readDodoBillingConfig } = await import("./dodo-config")
  const { dodoClient } = await import("./dodo-client")
  const local = await readTeamSubscription(db, id)
  if (local.billingSource !== "dodo") return
  const [state] = await db
    .select()
    .from(teamBillingState)
    .where(eq(teamBillingState.workspaceId, id))
    .limit(1)
  const target = state?.pendingSeatReduction ?? local.scheduledSeatQuantity
  if (
    target === null ||
    target === undefined ||
    (await teamOccupiedSeats(db, id)) + 1 <= target
  )
    return
  const config = readDodoBillingConfig()
  if (!config?.teamProducts)
    throw new Error("Team billing is unavailable. Try inviting again later.")
  await cancelTeamScheduledChange(id, undefined, dodoClient(), config)
}

export async function assertTeamDeletionAllowed(id: string) {
  const [local] = await db
    .select()
    .from(workspaceSubscriptions)
    .where(whereTeam(id))
    .limit(1)
  if (!local) return
  if (local.billingSource !== "dodo" && !local.dodoCustomerId) return
  const { readDodoBillingConfig } = await import("./dodo-config")
  const { dodoClient } = await import("./dodo-client")
  const config = readDodoBillingConfig()
  if (!config?.teamProducts)
    throw new Error(
      "Billing must be available before deleting a paid workspace."
    )
  await reconcileTeam(id, dodoClient(), config)
  const fresh = await readTeamSubscription(db, id)
  if (!fresh.dodoSubscriptionId) {
    const [state] = await db
      .select()
      .from(teamBillingState)
      .where(eq(teamBillingState.workspaceId, id))
      .limit(1)
    if (state && fresh.dodoCustomerId)
      throw new Error(
        "This checkout is still open. Contact Sparkable before deleting the workspace."
      )
    return
  }
  const remote = await dodoClient().subscriptions.retrieve(
    fresh.dodoSubscriptionId
  )
  if (!["cancelled", "expired"].includes(remote.status))
    throw new Error(
      "Wait until your subscription ends before deleting this workspace."
    )
}
