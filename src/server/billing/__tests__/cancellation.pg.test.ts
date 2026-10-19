import { randomUUID } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import type { Database } from "@/db/client"
import type { UnwrapWebhookEvent } from "dodopayments/resources/webhooks/webhooks"
import { createDb } from "@/db/client"
import { creditLedger, feeds, user, workspaceSubscriptions } from "@/db/schema"

let database: Database
vi.mock("@/db/index", () => ({
  get db() {
    return database
  },
}))
const { ingestVerifiedDodoWebhook } = await import("../personal-webhooks")
const { resolveEntitlements } = await import("@/server/entitlements/resolve")
const { refreshPersonalSubscriptionLifecycle } =
  await import("../personal-lifecycle")

describe.runIf(process.env.RUN_PLATFORM_POSTGRES_TESTS === "true")(
  "cancellation access on PostgreSQL",
  () => {
    let id: string
    const config = {
      apiKey: "test",
      webhookSecret: "test",
      environment: "test_mode" as const,
      appUrl: "http://localhost:3000",
      personalProducts: {
        monthly: "personal-monthly",
        annual: "personal-annual",
      },
    }
    beforeEach(async () => {
      const url = process.env.DATABASE_URL
      if (!url || !new URL(url).pathname.endsWith("_qa"))
        throw new Error("Use a disposable *_qa database")
      database = createDb(url)
      vi.stubEnv("SPARKFEED_EDITION", "cloud")
      id = `cancellation-${randomUUID()}`
      await database
        .insert(user)
        .values({
          id,
          name: "Cancellation QA",
          email: `${id}@example.test`,
          emailVerified: true,
          dodoCustomerId: `customer-${id}`,
        })
      await database
        .insert(workspaceSubscriptions)
        .values({
          workspaceType: "personal",
          workspaceId: id,
          planKey: "personal_plus",
          billingSource: "dodo",
          subscriptionStatus: "active",
          accessState: "active",
          dodoSubscriptionId: `sub-${id}`,
          currentPeriodStart: "2026-09-17T00:00:00Z",
          currentPeriodEnd: "2026-10-17T00:00:00Z",
        })
      await database
        .insert(feeds)
        .values(
          Array.from({ length: 8 }, (_, i) => ({
            id: `${id}-${i}`,
            workspaceId: id,
            name: `Source ${i}`,
            url: `https://example.test/${i}`,
            kind: i === 0 ? "rss" : "page",
          }))
        )
    })
    afterEach(async () => {
      if (id) {
        await database.delete(feeds).where(eq(feeds.workspaceId, id))
        await database
          .delete(creditLedger)
          .where(eq(creditLedger.workspaceId, id))
        await database
          .delete(workspaceSubscriptions)
          .where(eq(workspaceSubscriptions.workspaceId, id))
        await database.delete(user).where(eq(user.id, id))
      }
      vi.unstubAllEnvs()
    })
    it("handles a generic cancellation update as active Free access without deleting RSS or saved sources", async () => {
      const event = {
        type: "subscription.updated",
        timestamp: new Date().toISOString(),
        business_id: "test",
        data: {
          subscription_id: `sub-${id}`,
          status: "cancelled",
          product_id: "personal-monthly",
          customer: { customer_id: `customer-${id}` },
          metadata: { billingSubjectType: "personal", billingSubjectId: id },
          previous_billing_date: "2026-09-17T00:00:00Z",
          next_billing_date: "2026-10-17T00:00:00Z",
        },
      } as unknown as UnwrapWebhookEvent
      await ingestVerifiedDodoWebhook({
        webhookId: `webhook-${id}`,
        rawBody: JSON.stringify(event),
        event,
        config,
      })
      const access = await resolveEntitlements(
        { type: "personal", id },
        {
          type: "session",
          userId: id,
          emailVerified: true,
          workspaceId: id,
          demo: false,
        }
      )
      expect(access).toMatchObject({
        plan: "free",
        billingStatus: "free",
        accessState: "active",
        apiAccess: false,
        sourceUnitCapacity: 5,
      })
      const sources = await database
        .select()
        .from(feeds)
        .where(eq(feeds.workspaceId, id))
      expect(sources).toHaveLength(8)
      expect(
        sources.find((f) => f.kind === "rss")?.entitlementPausedAt
      ).toBeNull()
      expect(
        sources.filter((f) => f.kind === "page" && !f.entitlementPausedAt)
      ).toHaveLength(5)
      const [before] = await database
        .select()
        .from(workspaceSubscriptions)
        .where(eq(workspaceSubscriptions.workspaceId, id))
      event.timestamp = new Date(
        Date.parse(event.timestamp) + 1000
      ).toISOString()
      await ingestVerifiedDodoWebhook({
        webhookId: `repeat-${id}`,
        rawBody: JSON.stringify(event),
        event,
        config,
      })
      const [after] = await database
        .select()
        .from(workspaceSubscriptions)
        .where(eq(workspaceSubscriptions.workspaceId, id))
      expect(after.paidCreditRetentionEndsAt).toBe(
        before.paidCreditRetentionEndsAt
      )
      expect(after.planKey).toBe("free")
    })
    it("repairs access during payment grace and falls back to writable Free at its deadline", async () => {
      const now = new Date(),
        deadline = new Date(now.getTime() + 86400000)
      await database
        .update(workspaceSubscriptions)
        .set({
          subscriptionStatus: "past_due",
          accessState: "read_only",
          failedPaymentGraceDeadline: deadline.toISOString(),
        })
        .where(eq(workspaceSubscriptions.workspaceId, id))
      await refreshPersonalSubscriptionLifecycle(id, now)
      let [row] = await database
        .select()
        .from(workspaceSubscriptions)
        .where(eq(workspaceSubscriptions.workspaceId, id))
      expect(row.accessState).toBe("active")
      await refreshPersonalSubscriptionLifecycle(id, deadline)
      ;[row] = await database
        .select()
        .from(workspaceSubscriptions)
        .where(eq(workspaceSubscriptions.workspaceId, id))
      expect(row).toMatchObject({
        planKey: "free",
        accessState: "active",
        subscriptionStatus: "past_due",
        billingSource: "dodo",
      })
    })
  }
)
