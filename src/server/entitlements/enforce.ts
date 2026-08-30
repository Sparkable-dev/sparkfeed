import { and, count, eq, isNull } from "drizzle-orm"
import { resolveEntitlements } from "./resolve"
import { workspaceRefFromId } from "./workspace"
import type { Principal, ResolvedEntitlements } from "./types"
import { feeds } from "@/db/schema"
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
  additionalSources: number
): Promise<void> {
  if (additionalSources <= 0) return

  const entitlements = await entitlementsForWorkspaceId(workspaceId, {
    type: "system",
    userId: null,
    emailVerified: false,
    workspaceId,
    demo: false,
  })
  if (entitlements.accessState !== "active") {
    throw new EntitlementError("This workspace is not writable.")
  }
  if (entitlements.sourceUnitCapacity === null) return

  const [row] = await db
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
