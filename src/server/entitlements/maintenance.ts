import { and, asc, eq, gt, or } from "drizzle-orm"
import { grantWorkspaceAllowance } from "./allowances"
import type { SQL } from "drizzle-orm"
import type { WorkspaceRef } from "./types"
import { db } from "@/db/index"
import { member, workspaceSubscriptions } from "@/db/schema"
import { refreshPersonalSubscriptionLifecycle } from "@/server/billing/personal-lifecycle"

/** Bounded keyset batches; multiple workers are safe because grants lock/dedupe. */
export async function refreshWorkspaceAllowances() {
  let cursor: WorkspaceRef | null = null
  let processed = 0
  for (;;) {
    const after: SQL | undefined = cursor
      ? or(
          gt(workspaceSubscriptions.workspaceType, cursor.type),
          and(
            eq(workspaceSubscriptions.workspaceType, cursor.type),
            gt(workspaceSubscriptions.workspaceId, cursor.id)
          )
        )
      : undefined
    const batch = await db
      .select({
        type: workspaceSubscriptions.workspaceType,
        id: workspaceSubscriptions.workspaceId,
      })
      .from(workspaceSubscriptions)
      .where(after)
      .orderBy(
        asc(workspaceSubscriptions.workspaceType),
        asc(workspaceSubscriptions.workspaceId)
      )
      .limit(100)
    if (!batch.length) return { processed }
    for (const workspace of batch) {
      if (workspace.type === "personal") {
        await refreshPersonalSubscriptionLifecycle(workspace.id)
        await grantWorkspaceAllowance(workspace, workspace.id)
      } else {
        if (process.env.SPARKFEED_EDITION === "cloud") {
          const { refreshTeamLifecycle, reconcileTeam, applyQueuedTeamReduction } = await import("../billing/team-subscriptions")
          await refreshTeamLifecycle(workspace.id)
          try {
            const { readDodoBillingConfig, readTeamProducts } = await import("../billing/dodo-config")
            if (readTeamProducts()) {
              const { dodoClient } = await import("../billing/dodo-client")
              const config = readDodoBillingConfig()!
              await applyQueuedTeamReduction(workspace.id, dodoClient(), config)
              await reconcileTeam(workspace.id, dodoClient(), config)
            }
          } catch (error) {
            console.error("[team-billing] Scheduled reconciliation failed", workspace.id, error instanceof Error ? error.message : "Unknown error")
          }
          await refreshTeamLifecycle(workspace.id)
        }
        const people = await db
          .select({ id: member.userId })
          .from(member)
          .where(eq(member.organizationId, workspace.id))
        for (const person of people)
          await grantWorkspaceAllowance(workspace, person.id)
      }
      processed++
    }
    cursor = batch[batch.length - 1]
  }
}
