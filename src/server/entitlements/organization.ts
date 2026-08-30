import { APIError } from "better-auth/api"
import { and, eq } from "drizzle-orm"
import { resolveEntitlements } from "./resolve"
import { db } from "@/db/index"
import { session } from "@/db/schema"
import { organizationWorkspaceRef } from "@/lib/workspaces"

interface OrganizationActor {
  id: string
  emailVerified: boolean
}

export async function assertOrganizationManagementAllowed(
  organizationId: string,
  actor: OrganizationActor
): Promise<void> {
  const entitlements = await resolveEntitlements(
    organizationWorkspaceRef(organizationId),
    {
      type: "session",
      userId: actor.id,
      emailVerified: actor.emailVerified,
      workspaceId: organizationId,
      demo: false,
    }
  )

  if (!entitlements.canManageInvitations) {
    throw new APIError("FORBIDDEN", {
      message: "This workspace plan does not include team management.",
    })
  }
}

export async function clearRemovedOrganizationSessions(
  userId: string,
  organizationId: string
): Promise<void> {
  await db
    .update(session)
    .set({ activeOrganizationId: null })
    .where(
      and(
        eq(session.userId, userId),
        eq(session.activeOrganizationId, organizationId)
      )
    )
}
