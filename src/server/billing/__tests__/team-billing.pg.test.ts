import { createHmac, randomUUID } from "node:crypto"
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { and, eq } from "drizzle-orm"
import DodoPayments from "dodopayments"
import type { Subscription } from "dodopayments/resources/subscriptions"
import type { Database } from "@/db/client"
import type { DodoBillingConfig } from "../dodo-config"
import { createDb } from "@/db/client"
import {
  creditLedger,
  dodoWebhookInbox,
  feeds,
  invitation,
  member,
  organization,
  teamBillingState,
  user,
  workspaceOverrides,
  workspaceSubscriptions,
} from "@/db/schema"

let database: Database
vi.mock("@/db/index", () => ({
  get db() {
    return database
  },
}))
vi.mock("../dodo-client", () => ({ dodoClient: () => client }))
const service = await import("../team-subscriptions")
const { resolveEntitlements } = await import("@/server/entitlements/resolve")
const { grantWorkspaceAllowance } =
  await import("@/server/entitlements/allowances")
const { teamCart, teamPurchaseFromProvider, teamLifecycle } =
  await import("../team-policy")
const config: DodoBillingConfig = {
  apiKey: "test",
  webhookSecret: "test",
  environment: "test_mode",
  appUrl: "http://localhost:3000",
  personalProducts: { monthly: "personal-monthly", annual: "personal-annual" },
  teamProducts: {
    monthly: { productId: "pro-monthly", addonId: "seat-monthly" },
    annual: { productId: "pro-annual", addonId: "seat-annual" },
  },
}
const actor = `team-qa-${randomUUID()}`
const outsider = `${actor}-other`
const purchase = { interval: "monthly" as const, seats: 3 }
const created: Array<string> = []
let remote: Subscription
let client: DodoPayments
let checkout: ReturnType<typeof vi.fn>
let change: ReturnType<typeof vi.fn>
let preview: ReturnType<typeof vi.fn>
let portal: ReturnType<typeof vi.fn>
let cancelSchedule: ReturnType<typeof vi.fn>
const at = new Date()
const future = new Date(at.getTime() + 30 * 86400000).toISOString()
async function pending() {
  const team = await service.createPendingTeam(
    actor,
    "QA team",
    purchase,
    randomUUID()
  )
  created.push(team.id)
  return team.id
}
async function subscribed() {
  const id = await pending()
  await service.startTeamCheckout(id, actor, purchase, client, config)
  const [state] = await database
    .select()
    .from(teamBillingState)
    .where(eq(teamBillingState.workspaceId, id))
  remote = {
    subscription_id: `sub-${id}`,
    product_id: "pro-monthly",
    quantity: 1,
    addons: [{ addon_id: "seat-monthly", quantity: 2 }],
    status: "active",
    currency: "USD",
    customer: { customer_id: `customer-${id}` },
    metadata: {
      billingSubjectType: "organization",
      billingSubjectId: id,
      environment: "test_mode",
      checkoutAttemptId: state.attemptId,
    },
    previous_billing_date: new Date().toISOString(),
    next_billing_date: future,
    cancel_at_next_billing_date: false,
    created_at: at.toISOString(),
  } as unknown as Subscription
  await service.syncTeamSubscription(remote, config)
  return id
}
describe.runIf(process.env.RUN_TEAM_POSTGRES_TESTS === "true")(
  "Team billing on PostgreSQL",
  () => {
    beforeAll(async () => {
      const url = process.env.DATABASE_URL
      if (
        !url ||
        !new URL(url).pathname.endsWith("_qa") ||
        !["localhost", "127.0.0.1"].includes(new URL(url).hostname)
      )
        throw new Error("Use a local disposable *_qa database")
      database = createDb(url)
      vi.stubEnv("SPARKFEED_EDITION", "cloud")
      vi.stubEnv("APP_URL", config.appUrl)
      vi.stubEnv("DODO_PAYMENTS_ENVIRONMENT", "test_mode")
      vi.stubEnv("DODO_PAYMENTS_API_KEY", "test")
      vi.stubEnv("DODO_PAYMENTS_WEBHOOK_SECRET", "test")
      vi.stubEnv("DODO_PERSONAL_MONTHLY_PRODUCT_ID", "personal-monthly")
      vi.stubEnv("DODO_PERSONAL_ANNUAL_PRODUCT_ID", "personal-annual")
      vi.stubEnv("DODO_PRO_MONTHLY_PRODUCT_ID", "pro-monthly")
      vi.stubEnv("DODO_PRO_MONTHLY_SEAT_ADDON_ID", "seat-monthly")
      vi.stubEnv("DODO_PRO_ANNUAL_PRODUCT_ID", "pro-annual")
      vi.stubEnv("DODO_PRO_ANNUAL_SEAT_ADDON_ID", "seat-annual")
      await database.insert(user).values([
        {
          id: actor,
          name: "Owner",
          email: `${actor}@example.test`,
          emailVerified: true,
        },
        {
          id: outsider,
          name: "Other",
          email: `${outsider}@example.test`,
          emailVerified: true,
        },
      ])
    })
    beforeEach(() => {
      checkout = vi.fn().mockResolvedValue({
        session_id: "checkout-1",
        checkout_url: "https://test.checkout.dodopayments.com/test",
      })
      change = vi.fn().mockResolvedValue({})
      preview = vi.fn().mockImplementation(() => ({
        immediate_charge: {
          effective_at: at.toISOString(),
          summary: {
            total_amount: 1200,
            currency: "USD",
            customer_credits: 0,
            settlement_amount: 1200,
            settlement_currency: "USD",
          },
        },
        new_plan: { ...remote, next_billing_date: future },
      }))
      portal = vi.fn().mockResolvedValue({
        link: "https://test.customer.dodopayments.com/test",
      })
      cancelSchedule = vi.fn().mockImplementation(() => {
        remote.scheduled_change = null
      })
      client = {
        customers: {
          create: vi.fn().mockImplementation((data) => ({
            customer_id: `customer-${data.metadata.billingSubjectId}`,
          })),
          customerPortal: { create: portal },
        },
        checkoutSessions: { create: checkout },
        subscriptions: {
          list: () => ({ async *[Symbol.asyncIterator]() {} }),
          retrieve: vi.fn().mockImplementation(() => remote),
          changePlan: change,
          previewChangePlan: preview,
          cancelChangePlan: cancelSchedule,
          update: vi.fn().mockImplementation((_id, input) => {
            Object.assign(remote, input)
            return remote
          }),
        },
      } as unknown as DodoPayments
    })
    afterAll(async () => {
      if (!database) return
      for (const id of created) {
        await database.delete(feeds).where(eq(feeds.workspaceId, id))
        await database
          .delete(dodoWebhookInbox)
          .where(eq(dodoWebhookInbox.subjectId, id))
        await database
          .delete(workspaceOverrides)
          .where(eq(workspaceOverrides.workspaceId, id))
        await database
          .delete(creditLedger)
          .where(eq(creditLedger.workspaceId, id))
        await database
          .delete(workspaceSubscriptions)
          .where(
            and(
              eq(workspaceSubscriptions.workspaceType, "organization"),
              eq(workspaceSubscriptions.workspaceId, id)
            )
          )
        await database.delete(organization).where(eq(organization.id, id))
      }
      await database.delete(user).where(eq(user.id, actor))
      await database.delete(user).where(eq(user.id, outsider))
      await (
        database as unknown as { $client: { end: () => Promise<void> } }
      ).$client.end()
    })
    it("reuses a create request and leaves the workspace owner-only and read-only", async () => {
      const key = randomUUID()
      const results = await Promise.all([
        service.createPendingTeam(actor, "Team", purchase, key),
        service.createPendingTeam(actor, "Team", purchase, key),
      ])
      created.push(results[0].id)
      expect(results[0].id).toBe(results[1].id)
      expect(
        await database
          .select()
          .from(member)
          .where(eq(member.organizationId, results[0].id))
      ).toHaveLength(1)
      const ent = await resolveEntitlements(
        { type: "organization", id: results[0].id },
        {
          type: "session",
          userId: actor,
          emailVerified: true,
          workspaceId: results[0].id,
          demo: false,
        }
      )
      expect(ent.accessState).toBe("read_only")
      expect(ent.canManageInvitations).toBe(false)
      expect(ent.managedAiAccess).toBe(false)
    })
    it("resumes checkout and keeps provider cart and metadata server-owned", async () => {
      const id = await pending()
      const first = await service.startTeamCheckout(
        id,
        actor,
        purchase,
        client,
        config
      )
      expect(
        await service.startTeamCheckout(id, actor, purchase, client, config)
      ).toEqual(first)
      expect(checkout).toHaveBeenCalledTimes(1)
      expect(checkout.mock.calls[0][0].product_cart).toEqual([
        {
          product_id: "pro-monthly",
          quantity: 1,
          addons: [{ addon_id: "seat-monthly", quantity: 2 }],
        },
      ])
      expect(checkout.mock.calls[0][0].customer.customer_id).toBe(
        `customer-${id}`
      )
      expect(checkout.mock.calls[0][0].metadata.billingSubjectId).toBe(id)
      expect(
        (await service.readTeamSubscription(database, id)).accessState
      ).toBe("read_only")
    })
    it("uses the same idempotency key after a lost checkout response", async () => {
      const id = await pending()
      checkout.mockRejectedValueOnce(new Error("response lost"))
      await expect(
        service.startTeamCheckout(id, actor, purchase, client, config)
      ).rejects.toThrow("response lost")
      await service.startTeamCheckout(id, actor, purchase, client, config)
      expect(checkout.mock.calls[0][1].idempotencyKey).toBe(
        checkout.mock.calls[1][1].idempotencyKey
      )
    })
    it("rejects non-owner checkout and portal access before contacting Dodo", async () => {
      const id = await pending()
      await expect(
        service.startTeamCheckout(id, outsider, purchase, client, config)
      ).rejects.toThrow("Owner")
      await expect(service.teamPortal(id, outsider, client)).rejects.toThrow(
        "Owner"
      )
      expect(checkout).not.toHaveBeenCalled()
      expect(portal).not.toHaveBeenCalled()
    })
    it("activates only the paid Team and grants credits once", async () => {
      const id = await subscribed()
      await service.syncTeamSubscription(remote, config)
      const row = await service.readTeamSubscription(database, id)
      expect(row.paidSeatQuantity).toBe(3)
      expect(row.accessState).toBe("active")
      await Promise.all([
        grantWorkspaceAllowance({ type: "organization", id }, actor),
        grantWorkspaceAllowance({ type: "organization", id }, actor),
      ])
      const grants = await database
        .select()
        .from(creditLedger)
        .where(eq(creditLedger.workspaceId, id))
      expect(grants.reduce((sum, entry) => sum + entry.amount, 0)).toBe(200)
      const personal = await database
        .select()
        .from(workspaceSubscriptions)
        .where(eq(workspaceSubscriptions.workspaceId, actor))
      expect(personal).toHaveLength(0)
    })
    it("rejects cross-environment, customer, product and stale checkout identities", async () => {
      await subscribed()
      await expect(
        service.syncTeamSubscription(
          {
            ...remote,
            metadata: { ...remote.metadata, environment: "live_mode" },
          },
          config
        )
      ).rejects.toThrow("environment")
      await expect(
        service.syncTeamSubscription(
          { ...remote, customer: { ...remote.customer, customer_id: "wrong" } },
          config
        )
      ).rejects.toThrow("customer")
      await expect(
        service.syncTeamSubscription(
          { ...remote, product_id: "personal-monthly" },
          config
        )
      ).rejects.toThrow("product")
      await expect(
        service.syncTeamSubscription(
          {
            ...remote,
            metadata: { ...remote.metadata, checkoutAttemptId: "old" },
          },
          config
        )
      ).resolves.toBeUndefined()
    })
    it("keeps a failed first payment read-only without granting paid access", async () => {
      const id = await subscribed()
      await database
        .update(workspaceSubscriptions)
        .set({
          subscriptionStatus: "checkout_pending",
          currentPeriodStart: null,
        })
        .where(eq(workspaceSubscriptions.workspaceId, id))
      remote.status = "failed"
      await service.syncTeamSubscription(remote, config)
      const row = await service.readTeamSubscription(database, id)
      expect(row.subscriptionStatus).toBe("checkout_pending")
      expect(row.accessState).toBe("read_only")
      expect(row.currentPeriodStart).toBeNull()
    })
    it("does not extend the grace period on repeated failure events", async () => {
      const id = await subscribed()
      remote.status = "on_hold"
      const failureAt = new Date(Date.now() + 1000)
      await service.syncTeamSubscription(remote, config, failureAt)
      const first = await service.readTeamSubscription(database, id)
      expect(first.accessState).toBe("active")
      await service.syncTeamSubscription(
        remote,
        config,
        new Date(failureAt.getTime() + 86400000)
      )
      expect(
        (await service.readTeamSubscription(database, id))
          .failedPaymentGraceDeadline
      ).toBe(first.failedPaymentGraceDeadline)
      await service.refreshTeamLifecycle(
        id,
        new Date(failureAt.getTime() + 14 * 86400000)
      )
      expect(
        (await service.readTeamSubscription(database, id)).accessState
      ).toBe("read_only")
    })
    it("preserves access through scheduled cancellation, then stops access", async () => {
      const id = await subscribed()
      await service.setTeamCancellation(id, actor, true, client, config)
      const row = await service.readTeamSubscription(database, id)
      expect(row.subscriptionStatus).toBe("canceled")
      expect(row.accessState).toBe("active")
      await service.refreshTeamLifecycle(id, new Date(Date.parse(future) + 1))
      expect(
        (await service.readTeamSubscription(database, id)).accessState
      ).toBe("read_only")
      remote.status = "cancelled"
      await service.syncTeamSubscription(remote, config)
      expect(
        (await service.readTeamSubscription(database, id)).accessState
      ).toBe("read_only")
    })
    it("rejects changed quotes and schedules reductions without granting unpaid seats", async () => {
      const id = await subscribed()
      const next = { interval: "monthly" as const, seats: 2 }
      const quote = await service.changeTeamPlan(
        id,
        actor,
        next,
        true,
        client,
        config
      )
      await expect(
        service.changeTeamPlan(id, actor, next, false, client, config, "wrong")
      ).rejects.toThrow("estimate changed")
      expect(change).not.toHaveBeenCalled()
      await service.changeTeamPlan(
        id,
        actor,
        next,
        false,
        client,
        config,
        quote.token
      )
      expect(change.mock.calls[0][1]).toMatchObject({
        effective_at: "next_billing_date",
        proration_billing_mode: "do_not_bill",
        on_payment_failure: "prevent_change",
      })
      expect(
        (await service.readTeamSubscription(database, id)).paidSeatQuantity
      ).toBe(3)
    })
    it("serializes concurrent invitations at paid capacity", async () => {
      const id = await subscribed()
      const insert = (n: number) =>
        database.insert(invitation).values({
          id: randomUUID(),
          organizationId: id,
          email: `invite${n}@example.test`,
          role: "editor",
          status: "pending",
          inviterId: actor,
          expiresAt: new Date(future),
        })
      const results = await Promise.allSettled([
        insert(1),
        insert(2),
        insert(3),
      ])
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2)
      expect(await service.teamOccupiedSeats(database, id)).toBe(3)
      await expect(
        service.changeTeamPlan(
          id,
          actor,
          { interval: "annual", seats: 2 },
          true,
          client,
          config
        )
      ).rejects.toThrow("Remove members")
    })
    it("keeps manual access until the online migration is paid", async () => {
      const id = await subscribed()
      await database
        .update(workspaceSubscriptions)
        .set({
          billingSource: "manual",
          overrideSeatLimit: 8,
          providerEventAt: null,
        })
        .where(eq(workspaceSubscriptions.workspaceId, id))
      remote.status = "failed"
      await service.syncTeamSubscription(remote, config)
      expect(
        (await service.readTeamSubscription(database, id)).billingSource
      ).toBe("manual")
      remote.status = "active"
      await service.syncTeamSubscription(remote, config)
      const row = await service.readTeamSubscription(database, id)
      expect(row.billingSource).toBe("dodo")
      expect(row.overrideSeatLimit).toBeNull()
    })
    it("stores automatic seat reductions and retries them after provider failure", async () => {
      const id = await subscribed()
      await service.queueTeamSeatReduction(id)
      change.mockRejectedValueOnce(new Error("offline"))
      await expect(
        service.applyQueuedTeamReduction(id, client, config)
      ).rejects.toThrow("offline")
      let [state] = await database
        .select()
        .from(teamBillingState)
        .where(eq(teamBillingState.workspaceId, id))
      expect(state.pendingSeatReduction).toBe(2)
      await service.applyQueuedTeamReduction(id, client, config)
      ;[state] = await database
        .select()
        .from(teamBillingState)
        .where(eq(teamBillingState.workspaceId, id))
      expect(state.pendingSeatReduction).toBeNull()
      expect(change.mock.calls[1][1]).toMatchObject({
        effective_at: "next_billing_date",
        addons: [{ addon_id: "seat-monthly", quantity: 1 }],
      })
    })
    it("verifies signed Team webhooks, fetches current state and deduplicates delivery", async () => {
      const id = await subscribed()
      const { ingestVerifiedDodoWebhook, unwrapDodoWebhook } =
        await import("../personal-webhooks")
      const key = Buffer.from("local-team-webhook-qa-secret")
      const verifier = new DodoPayments({
        bearerToken: "test",
        environment: "test_mode",
        webhookKey: `whsec_${key.toString("base64")}`,
      })
      const webhookId = `event-${id}`
      const timestamp = String(Math.floor(Date.now() / 1000))
      // The old event says failed, but the provider has already recovered to active.
      const body = JSON.stringify({
        type: "subscription.failed",
        timestamp: at.toISOString(),
        data: { ...remote, status: "failed" },
      })
      const signature = createHmac("sha256", key)
        .update(`${webhookId}.${timestamp}.${body}`)
        .digest("base64")
      const headers = new Headers({
        "webhook-id": webhookId,
        "webhook-timestamp": timestamp,
        "webhook-signature": `v1,${signature}`,
      })
      expect(() => unwrapDodoWebhook(verifier, body + " ", headers)).toThrow()
      const verified = unwrapDodoWebhook(verifier, body, headers)
      await ingestVerifiedDodoWebhook({ ...verified, rawBody: body, config })
      expect(
        (await service.readTeamSubscription(database, id)).subscriptionStatus
      ).toBe("active")
      expect(
        await ingestVerifiedDodoWebhook({ ...verified, rawBody: body, config })
      ).toEqual({ duplicate: true })
    })
    it("preserves operator restrictions when provider billing becomes active", async () => {
      const id = await subscribed()
      await database.insert(workspaceOverrides).values({
        workspaceType: "organization",
        workspaceId: id,
        accessRestriction: "suspended",
        reason: "QA restriction",
        actorId: "qa-operator",
        createdAt: at.toISOString(),
        updatedAt: at.toISOString(),
      })
      await service.syncTeamSubscription(remote, config)
      const ent = await resolveEntitlements(
        { type: "organization", id },
        {
          type: "session",
          userId: actor,
          emailVerified: true,
          workspaceId: id,
          demo: false,
        }
      )
      expect(ent.accessState).toBe("suspended")
      expect(ent.apiAccess).toBe(false)
    })
    it("uses the current owner for portal authority after transfer", async () => {
      const id = await subscribed()
      await database.transaction(async (tx) => {
        await tx
          .update(member)
          .set({ role: "editor" })
          .where(eq(member.organizationId, id))
        await tx.insert(member).values({
          id: randomUUID(),
          organizationId: id,
          userId: outsider,
          role: "owner",
        })
      })
      await expect(service.teamPortal(id, actor, client)).rejects.toThrow(
        "Owner"
      )
      await expect(
        service.teamPortal(id, outsider, client)
      ).resolves.toHaveProperty("link")
      expect(portal.mock.calls[0][0]).toBe(`customer-${id}`)
    })
    it("cancels a scheduled reduction and retains current paid capacity", async () => {
      const id = await subscribed()
      remote.scheduled_change = {
        id: "schedule",
        product_id: "pro-monthly",
        quantity: 1,
        addons: [],
        effective_at: future,
        created_at: at.toISOString(),
      }
      await service.syncTeamSubscription(remote, config)
      expect(
        (await service.readTeamSubscription(database, id)).scheduledSeatQuantity
      ).toBe(1)
      await service.cancelTeamScheduledChange(id, actor, client, config)
      expect(cancelSchedule).toHaveBeenCalledTimes(1)
      expect(
        (await service.readTeamSubscription(database, id)).scheduledSeatQuantity
      ).toBeNull()
      expect(
        (await service.readTeamSubscription(database, id)).paidSeatQuantity
      ).toBe(3)
    })
    it("does not silently alter a stored checkout purchase", async () => {
      const id = await pending()
      await expect(
        service.startTeamCheckout(
          id,
          actor,
          { interval: "annual", seats: 4 },
          client,
          config
        )
      ).rejects.toThrow("Resume the existing checkout")
      expect(checkout).not.toHaveBeenCalled()
    })
    it("blocks deletion of an issued checkout", async () => {
      const id = await pending()
      await service.startTeamCheckout(id, actor, purchase, client, config)
      await expect(service.assertTeamDeletionAllowed(id)).rejects.toThrow("checkout is still open")
    })
    it("pauses excess website sources after a seat reduction and restores them on upgrade", async () => {
      const id = await subscribed()
      await database.insert(feeds).values(Array.from({ length: 51 }, (_, n) => ({ id: `${id}-source-${String(n).padStart(3, "0")}`, name: `Source ${n}`, url: `https://example.test/${n}`, workspaceId: id, kind: "page" as const })))
      remote.addons = []
      await service.syncTeamSubscription(remote, config)
      let rows = await database.select().from(feeds).where(eq(feeds.workspaceId, id))
      expect(rows).toHaveLength(51)
      expect(rows.filter((row) => !row.entitlementPausedAt)).toHaveLength(50)
      remote.addons = [{ addon_id: "seat-monthly", quantity: 1 }]
      await service.syncTeamSubscription(remote, config)
      rows = await database.select().from(feeds).where(eq(feeds.workspaceId, id))
      expect(rows.filter((row) => !row.entitlementPausedAt)).toHaveLength(51)
    })
    it("requires provider-confirmed termination before operator deletion", async () => {
      const id = await subscribed()
      const { deleteHostedOrganizations } = await import("@/server/platform/hosted-operations")
      remote.cancel_at_next_billing_date = true
      await service.syncTeamSubscription(remote, config)
      await expect(deleteHostedOrganizations([id])).rejects.toThrow("subscription ends")
      remote.status = "cancelled"
      await expect(deleteHostedOrganizations([id])).resolves.toHaveProperty("success", true)
      expect(await database.select().from(organization).where(eq(organization.id, id))).toHaveLength(0)
    })
  }
)

describe("Team billing policy", () => {
  it("validates seats and reconstructs capacity from only the allowed add-on", () => {
    expect(teamCart(config, { interval: "annual", seats: 1 })).toEqual({
      product_id: "pro-annual",
      quantity: 1,
      addons: [],
    })
    for (const seats of [0, 1.5, 11])
      expect(() => teamCart(config, { interval: "monthly", seats })).toThrow()
    expect(() =>
      teamPurchaseFromProvider(config, {
        product_id: "pro-monthly",
        quantity: 1,
        addons: [{ addon_id: "other", quantity: 2 }],
      })
    ).toThrow()
  })
  it("does not grant access to an unpaid subscription", () => {
    const result = teamLifecycle({ status: "failed" } as Subscription, {
      subscriptionStatus: "checkout_pending",
      currentPeriodStart: null,
      failedPaymentGraceDeadline: null,
    })
    expect(result.accessState).toBe("read_only")
  })
})
