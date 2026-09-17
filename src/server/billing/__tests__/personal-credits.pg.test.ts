import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

describe.runIf(process.env.RUN_POSTGRES_TESTS === "true")(
  "Personal+ credit ledger on PostgreSQL",
  () => {
    it("reserves both buckets and settles the measured Gateway cost", async () => {
      const { and, eq } = await import("drizzle-orm")
      const { db } = await import("@/db/index")
      const { aiUsageRequests, creditLedger, workspaceSubscriptions } =
        await import("@/db/schema")
      const { creditBalance } = await import("@/server/entitlements/credits")
      const {
        releaseManagedAiCredits,
        reserveManagedAiCredits,
        settleManagedAiCredits,
      } = await import("../personal-credits")

      const userId = `credit-test-${randomUUID()}`
      const workspace = { type: "personal" as const, id: userId }
      const now = new Date().toISOString()

      try {
        await db.insert(workspaceSubscriptions).values({
          workspaceType: "personal",
          workspaceId: userId,
          planKey: "personal_plus",
          billingSource: "manual",
          subscriptionStatus: "active",
          accessState: "active",
          paidSeatQuantity: 1,
          createdAt: now,
          updatedAt: now,
        })
        await db.insert(creditLedger).values([
          {
            id: randomUUID(),
            workspaceType: "personal",
            workspaceId: userId,
            beneficiaryUserId: userId,
            creditBucket: "free",
            amount: 10,
            entryType: "grant",
            reason: "test_free",
            idempotencyKey: `${userId}:free`,
            createdAt: now,
          },
          {
            id: randomUUID(),
            workspaceType: "personal",
            workspaceId: userId,
            beneficiaryUserId: userId,
            creditBucket: "paid",
            amount: 10,
            entryType: "grant",
            reason: "test_paid",
            idempotencyKey: `${userId}:paid`,
            createdAt: now,
          },
        ])

        const reservation = await reserveManagedAiCredits(
          workspace,
          userId,
          "request-1"
        )
        expect(reservation).not.toBeNull()
        expect(await creditBalance(workspace, userId)).toBe(0)

        await settleManagedAiCredits(reservation!, 0.03)
        expect(await creditBalance(workspace, userId, "free")).toBe(7)
        expect(await creditBalance(workspace, userId, "paid")).toBe(10)

        const released = await reserveManagedAiCredits(
          workspace,
          userId,
          "request-2"
        )
        await releaseManagedAiCredits(released!)
        expect(await creditBalance(workspace, userId)).toBe(17)

        const fractional = await reserveManagedAiCredits(
          workspace,
          userId,
          "request-3"
        )
        await settleManagedAiCredits(fractional!, 0.0002)
        expect(await creditBalance(workspace, userId)).toBe(16.98)
      } finally {
        await db
          .delete(aiUsageRequests)
          .where(eq(aiUsageRequests.beneficiaryUserId, userId))
        await db
          .delete(creditLedger)
          .where(
            and(
              eq(creditLedger.workspaceType, "personal"),
              eq(creditLedger.workspaceId, userId)
            )
          )
        await db
          .delete(workspaceSubscriptions)
          .where(
            and(
              eq(workspaceSubscriptions.workspaceType, "personal"),
              eq(workspaceSubscriptions.workspaceId, userId)
            )
          )
      }
    })
  }
)
