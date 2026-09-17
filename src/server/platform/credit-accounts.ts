import { randomUUID } from "node:crypto"
import { and, eq, sql } from "drizzle-orm"
import { z } from "zod"
import { workspaceInput } from "./contracts"
import { PlatformRequestError } from "./assertion"
import type { Database } from "@/db/client"
import type { WorkspaceRef } from "@/server/entitlements/types"
import { db } from "@/db/index"
import {
  creditLedger,
  member,
  organization,
  platformAdminAuditLog,
  user,
  workspaceSubscriptions,
} from "@/db/schema"
import { readEffectiveSubscription } from "@/server/entitlements/effective"

export interface CreditAccount {
  available: number
  free: number
  paid: number
  retained: number
  reserved: number
  revision: string
}
type Reader = Pick<Database, "execute">
/** Balances always belong to a person inside a workspace, never to a global user. */
export async function readCreditAccount(
  database: Reader,
  workspace: WorkspaceRef,
  userId: string,
  plan: string
): Promise<CreditAccount> {
  const [row] = await database.execute(sql`SELECT
    coalesce(sum(amount) FILTER (WHERE credit_bucket='free'),0) AS free,
    coalesce(sum(amount) FILTER (WHERE credit_bucket='paid'),0) AS paid,
    coalesce(sum(-amount) FILTER (WHERE entry_type='reservation' AND NOT EXISTS (
      SELECT 1 FROM credit_ledger done WHERE done.workspace_type=l.workspace_type AND done.workspace_id=l.workspace_id
      AND done.beneficiary_user_id=l.beneficiary_user_id AND done.ai_request_id=l.ai_request_id
      AND done.credit_bucket=l.credit_bucket AND done.entry_type IN ('settlement','refund'))),0) AS reserved,
    md5(coalesce(string_agg(id,',' ORDER BY id),'')) AS revision
    FROM credit_ledger l WHERE workspace_type=${workspace.type} AND workspace_id=${workspace.id} AND beneficiary_user_id=${userId}`)
  const free = Math.max(0, Number(row.free)),
    paid = Math.max(0, Number(row.paid))
  return {
    free,
    paid,
    available: free + (plan === "free" ? 0 : paid),
    retained: plan === "free" ? paid : 0,
    reserved: Number(row.reserved),
    revision: String(row.revision),
  }
}
const setCreditsInput = workspaceInput.extend({
  action: z.literal("set_credit_balance"),
  userId: z.string().min(1).max(200),
  balance: z.number().int().min(0).max(1000000),
  expectedPlan: z.enum(["free", "personal_plus", "pro", "enterprise"]),
  expectedRevision: z.string().regex(/^[a-f0-9]{32}$/),
  reason: z.string().trim().min(1).max(500),
})
export async function setCreditBalance(
  raw: unknown,
  actor: { userId: string; email: string }
) {
  const input = setCreditsInput.parse(raw),
    workspace = { type: input.workspaceType, id: input.workspaceId }
  return db.transaction(async (tx) => {
    const target = workspace.type === "personal" ? user : organization
    const [identity] = await tx
      .select({ id: target.id })
      .from(target)
      .where(eq(target.id, workspace.id))
      .for("update")
      .limit(1)
    if (!identity) throw new PlatformRequestError(404, "Workspace not found.")
    if (workspace.type === "personal" && workspace.id !== input.userId)
      throw new PlatformRequestError(
        400,
        "Personal credits belong to the workspace owner."
      )
    if (workspace.type === "organization") {
      const [accepted] = await tx
        .select({ id: member.id })
        .from(member)
        .where(
          and(
            eq(member.organizationId, workspace.id),
            eq(member.userId, input.userId)
          )
        )
        .limit(1)
      if (!accepted)
        throw new PlatformRequestError(
          409,
          "This person is no longer a member of this workspace."
        )
    }
    if (workspace.type === "personal")
      await tx
        .insert(workspaceSubscriptions)
        .values({
          workspaceType: "personal",
          workspaceId: workspace.id,
          planKey: "free",
          billingSource: "free",
          subscriptionStatus: "free",
          accessState: "active",
          paidSeatQuantity: 1,
        })
        .onConflictDoNothing()
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`${workspace.type}:${workspace.id}:${input.userId}`}))`
    )
    const effective = await readEffectiveSubscription(
      tx,
      workspace,
      new Date(),
      true
    )
    if (!effective)
      throw new PlatformRequestError(
        400,
        "Set a workspace plan before editing credits."
      )
    if (effective.planKey !== input.expectedPlan)
      throw new PlatformRequestError(
        409,
        "The workspace plan changed. Refresh before editing credits."
      )
    const before = await readCreditAccount(
      tx,
      workspace,
      input.userId,
      effective.planKey
    )
    if (before.revision !== input.expectedRevision)
      throw new PlatformRequestError(
        409,
        "Credits changed since you opened this form. Refresh the balance and try again."
      )
    if (before.reserved > 0)
      throw new PlatformRequestError(
        409,
        "An AI request is using these credits. Try again when it finishes."
      )
    if (workspace.type === "personal")
      await tx
        .insert(creditLedger)
        .values({
          id: randomUUID(),
          workspaceType: "personal",
          workspaceId: workspace.id,
          beneficiaryUserId: input.userId,
          creditBucket: "free",
          amount: 0,
          entryType: "grant",
          reason: "Starter allowance included in staff-set balance",
          idempotencyKey: `cloud-free:user:${input.userId}`,
        })
        .onConflictDoNothing()
    const paidPlan = effective.planKey !== "free"
    // Preserve the remaining one-time free allowance. Paid reductions consume paid credits first.
    const freeTarget = paidPlan
      ? Math.min(before.free, input.balance)
      : input.balance
    const paidTarget = paidPlan ? input.balance - freeTarget : before.paid
    const now = new Date().toISOString(),
      operationId = randomUUID()
    for (const [bucket, targetBalance] of [
      ["free", freeTarget],
      ["paid", paidTarget],
    ] as const) {
      if (bucket === "paid" && !paidPlan) continue
      const [sum] = await tx
        .select({
          amount: sql<number>`coalesce(sum(${creditLedger.amount}),0)`,
        })
        .from(creditLedger)
        .where(
          and(
            eq(creditLedger.workspaceType, workspace.type),
            eq(creditLedger.workspaceId, workspace.id),
            eq(creditLedger.beneficiaryUserId, input.userId),
            eq(creditLedger.creditBucket, bucket)
          )
        )
      const amount = targetBalance - Number(sum.amount)
      if (amount)
        await tx.insert(creditLedger).values({
          id: randomUUID(),
          workspaceType: workspace.type,
          workspaceId: workspace.id,
          beneficiaryUserId: input.userId,
          creditBucket: bucket,
          amount,
          entryType: "adjustment",
          actorUserId: actor.userId,
          reason: input.reason,
          idempotencyKey: `staff-balance:${operationId}:${bucket}`,
          createdAt: now,
        })
    }
    const after = await readCreditAccount(
      tx,
      workspace,
      input.userId,
      effective.planKey
    )
    await tx.insert(platformAdminAuditLog).values({
      id: operationId,
      actorUserId: actor.userId,
      action: "set_credit_balance",
      targetType: "workspace_credit",
      targetId: `${workspace.type}:${workspace.id}:${input.userId}`,
      reason: input.reason,
      beforeState: JSON.stringify(before),
      afterState: JSON.stringify(after),
      createdAt: now,
    })
    return after
  })
}
