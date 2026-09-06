import { eq } from "drizzle-orm"
import { sparkfeedEdition } from "./config"
import { resolveEntitlements } from "./resolve"
import { workspaceRefFromId } from "./workspace"
import { db } from "@/db/index"
import { feeds } from "@/db/schema"

/** Recheck at execution time: queued work may outlive a suspension or downgrade. */
export async function canIngestFeed(feedId: string) {
  if (sparkfeedEdition() === "community") return true
  const [feed] = await db
    .select({ workspaceId: feeds.workspaceId })
    .from(feeds)
    .where(eq(feeds.id, feedId))
    .limit(1)
  if (!feed?.workspaceId) return false
  const workspace = await workspaceRefFromId(feed.workspaceId)
  const effective = await resolveEntitlements(workspace, {
    type: "system",
    userId: null,
    emailVerified: false,
    workspaceId: feed.workspaceId,
    demo: false,
  })
  if (effective.accessState !== "active") return false
  const [current] = await db
    .select({ pausedAt: feeds.entitlementPausedAt })
    .from(feeds)
    .where(eq(feeds.id, feedId))
    .limit(1)
  return Boolean(current && !current.pausedAt)
}
