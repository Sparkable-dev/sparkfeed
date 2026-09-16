import { and, count, eq, isNull, sql } from "drizzle-orm"
import { resolveEntitlements } from "./resolve"
import { workspaceRefFromId } from "./workspace"
import { readEffectiveSubscription } from "./effective"
import type { Principal, ResolvedEntitlements } from "./types"
import type { Database } from "@/db/client"
import { feeds, organization, user } from "@/db/schema"
import { db } from "@/db/index"

export class EntitlementError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "EntitlementError"
  }
}

export async function entitlementsForWorkspaceId(
  workspaceId: string,
  principal: Principal
): Promise<ResolvedEntitlements> {
  return resolveEntitlements(await workspaceRefFromId(workspaceId), principal)
}

export async function assertNoRssSourceCapacity(
  workspaceId: string,
  additionalSources: number,
  database: Pick<Database, "select"> = db,
  resolved?: ResolvedEntitlements
): Promise<void> {
  if (additionalSources <= 0) return

  const entitlements =
    resolved ??
    (await entitlementsForWorkspaceId(workspaceId, {
      type: "system",
      userId: null,
      emailVerified: false,
      workspaceId,
      demo: false,
    }))
  if (entitlements.accessState !== "active") {
    throw new EntitlementError("This workspace is not writable.")
  }
  if (entitlements.sourceUnitCapacity === null) return

  const [row] = await database
    .select({ value: count() })
    .from(feeds)
    .where(
      and(
        eq(feeds.workspaceId, workspaceId),
        eq(feeds.kind, "page"),
        isNull(feeds.entitlementPausedAt)
      )
    )
  const current = Number(row?.value ?? 0)

  if (current + additionalSources > entitlements.sourceUnitCapacity) {
    throw new EntitlementError(
      `This workspace can have ${entitlements.sourceUnitCapacity} active website sources without RSS.`
    )
  }
}

/** Reserve capacity and insert in one transaction, including across app replicas. */
export async function withNoRssSourceCapacity<T>(
  workspaceId: string | null,
  additionalSources: number,
  write: (tx: Database) => Promise<T>
): Promise<T> {
  if (!workspaceId || additionalSources <= 0) return write(db)
  const workspace = await workspaceRefFromId(workspaceId)
  const effective = await resolveEntitlements(workspace, {
    type: "system",
    userId: null,
    emailVerified: false,
    workspaceId,
    demo: false,
  })
  if (effective.accessState !== "active")
    throw new EntitlementError("This workspace is not writable.")
  if (effective.sourceUnitCapacity === null) return write(db)
  return db.transaction(async (tx) => {
    // A portable no-op write locks the workspace row until commit. No advisory-lock dependency.
    const locked =
      workspace.type === "personal"
        ? await tx
            .update(user)
            .set({ updatedAt: sql`${user.updatedAt}` })
            .where(eq(user.id, workspaceId))
            .returning({ id: user.id })
        : await tx
            .update(organization)
            .set({ metadata: sql`${organization.metadata}` })
            .where(eq(organization.id, workspaceId))
            .returning({ id: organization.id })
    if (!locked.length) throw new EntitlementError("Workspace not found.")
    // Team billing can change while this writer waits for the organization lock.
    let current = effective
    if (workspace.type === "organization") {
      const subscription = await readEffectiveSubscription(tx, workspace)
      if (!subscription || subscription.accessState !== "active" || !["pro", "enterprise"].includes(subscription.planKey))
        throw new EntitlementError("This workspace is not writable.")
      current = { ...effective, sourceUnitCapacity: subscription.overrideSourceUnitLimit ?? (subscription.planKey === "pro" ? subscription.paidSeatQuantity * 50 : null) }
    }
    await assertNoRssSourceCapacity(
      workspaceId,
      additionalSources,
      tx,
      current
    )
    return write(tx)
  })
}
