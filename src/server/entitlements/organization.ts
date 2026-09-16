import { APIError } from "better-auth/api"
import { and, eq, gt, sql } from "drizzle-orm"
import { resolveEntitlements } from "./resolve"
import { db } from "@/db/index"
import { invitation, member, session } from "@/db/schema"
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

/** Billing restrictions must not prevent owners from cleaning up their data. */
export async function assertOrganizationCleanupAllowed(organizationId: string, actor: OrganizationActor) {
  const entitlements = await resolveEntitlements(organizationWorkspaceRef(organizationId), {
    type: "session", userId: actor.id, emailVerified: actor.emailVerified, workspaceId: organizationId, demo: false,
  })
  if (entitlements.accessState === "suspended") throw new APIError("FORBIDDEN", { message: "This workspace is suspended. Contact Sparkable." })
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

export async function assertOrganizationInvitationCapacity(
  organizationId: string,
  actor: OrganizationActor,
  email?: string
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
  if (entitlements.seatCapacity === null) return
  if (email) {
    const [existing] = await db
      .select({ id: invitation.id })
      .from(invitation)
      .where(
        and(
          eq(invitation.organizationId, organizationId),
          eq(invitation.status, "pending"),
          gt(invitation.expiresAt, new Date()),
          sql`lower(${invitation.email}) = ${email.trim().toLowerCase()}`
        )
      )
      .limit(1)
    if (existing) return
  }
  const [[members], [pending]] = await Promise.all([
    db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(member)
      .where(eq(member.organizationId, organizationId)),
    db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(invitation)
      .where(
        and(
          eq(invitation.organizationId, organizationId),
          eq(invitation.status, "pending"),
          gt(invitation.expiresAt, new Date())
        )
      ),
  ])
  if (
    Number(members?.count ?? 0) + Number(pending?.count ?? 0) >=
    entitlements.seatCapacity
  ) {
    throw new APIError("FORBIDDEN", {
      message: "This workspace has no available seats.",
    })
  }
}

async function actorRole(organizationId: string, userId: string) {
  const [row] = await db
    .select({ role: member.role })
    .from(member)
    .where(
      and(eq(member.organizationId, organizationId), eq(member.userId, userId))
    )
    .limit(1)
  return row?.role === "owner" || row?.role === "admin" ? row.role : "editor"
}

export async function assertInvitationRoleAllowed(input: {
  organizationId: string
  actorUserId: string
  invitedRole: string
}) {
  const role = await actorRole(input.organizationId, input.actorUserId)
  if (input.invitedRole === "owner" || input.invitedRole === "member") {
    throw new APIError("FORBIDDEN", {
      message: "Use the Owner, Admin, or Editor workspace roles.",
    })
  }
  if (role === "admin" && input.invitedRole !== "editor") {
    throw new APIError("FORBIDDEN", {
      message: "Admins can invite Editors only.",
    })
  }
}

export async function assertMemberRoleChangeAllowed(input: {
  organizationId: string
  actorUserId: string
  targetRole: string
  newRole: string
}) {
  const role = await actorRole(input.organizationId, input.actorUserId)
  if (input.targetRole === "owner" || input.newRole === "owner") {
    throw new APIError("FORBIDDEN", {
      message: "Use the ownership transfer action.",
    })
  }
  if (
    role === "admin" &&
    (input.targetRole !== "editor" || input.newRole !== "editor")
  ) {
    throw new APIError("FORBIDDEN", {
      message: "Admins can manage Editors only.",
    })
  }
}

export async function assertMemberRemovalAllowed(input: {
  organizationId: string
  actorUserId: string
  targetRole: string
}) {
  const role = await actorRole(input.organizationId, input.actorUserId)
  if (input.targetRole === "owner") {
    throw new APIError("FORBIDDEN", { message: "The Owner cannot be removed." })
  }
  if (role === "admin" && input.targetRole !== "editor") {
    throw new APIError("FORBIDDEN", {
      message: "Admins can remove Editors only.",
    })
  }
}
