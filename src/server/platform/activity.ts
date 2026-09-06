import { sql } from "drizzle-orm"
import type { WorkspaceRef } from "@/server/entitlements/types"
import { db } from "@/db/index"
import { platformActivityDays } from "@/db/schema"

const recent = new Map<string, number>()
/** Called only after a real customer session is authenticated, never by admin inventory reads. */
export async function recordPlatformActivity(
  userId: string,
  workspace: WorkspaceRef,
  at = new Date()
) {
  if (process.env.SPARKFEED_EDITION !== "cloud") return
  const day = at.toISOString().slice(0, 10),
    key = `${userId}:${workspace.type}:${workspace.id}:${day}`
  if ((recent.get(key) ?? 0) > at.getTime() - 60000) return
  try {
    await db
      .insert(platformActivityDays)
      .values({
        userId,
        workspaceType: workspace.type,
        workspaceId: workspace.id,
        day,
        lastSeenAt: at.toISOString(),
      })
      .onConflictDoUpdate({
        target: [
          platformActivityDays.userId,
          platformActivityDays.workspaceType,
          platformActivityDays.workspaceId,
          platformActivityDays.day,
        ],
        set: {
          lastSeenAt: sql`greatest(${platformActivityDays.lastSeenAt},${at.toISOString()})`,
        },
      })
    if (recent.size >= 10000) recent.clear()
    recent.set(key, at.getTime())
  } catch {
    console.warn("[activity] Could not record customer activity")
  }
}
