import { randomUUID } from "node:crypto"
import { createServerFn } from "@tanstack/react-start"
import { and, desc, eq, gt, ne, or, sql } from "drizzle-orm"
import { z } from "zod"
import type {
  EntitlementPlan,
  PlanKey,
  WorkspaceAccessState,
} from "@/server/entitlements/types"
import type { WorkspaceRole } from "@/lib/workspace-roles"
import { db } from "@/db/index"
import {
  billingRequests,
  feeds,
  invitation,
  member,
  organization,
  session,
  user,
  workspaceSubscriptions,
} from "@/db/schema"
import { canUserCreateWorkspace } from "@/server/community-policy"
import { deleteOrganizationWorkspaceData } from "@/server/account-deletion"
import { resolveEntitlements } from "@/server/entitlements/resolve"
import { sparkfeedEdition } from "@/server/entitlements/config"
import {
  canManageBilling,
  canManageWorkspace,
  normalizeWorkspaceRole,
} from "@/lib/workspace-roles"
import {
  organizationWorkspaceRef,
  personalWorkspaceName,
  personalWorkspaceRef,
  workspacePlanLabel,
} from "@/lib/workspaces"
import { sendTeamRequestNotification } from "@/lib/email"

export type TeamRequestStatus =
  "pending" | "in_review" | "approved" | "declined"

export interface TeamRequestSummary {
  id: string
  type: string
  workspaceName: string
  expectedSeats: number | null
  requestedPlan: PlanKey | null
  workspaceId: string | null
  status: TeamRequestStatus
  decisionNote: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface WorkspaceSummary {
  id: string
  type: "personal" | "organization"
  slug: string
  name: string
  logo: string | null
  role: WorkspaceRole
  plan: EntitlementPlan
  planLabel: string
  accessState: WorkspaceAccessState
  memberCount: number
  pendingInvitations: number
  feedCount: number
  isActive: boolean
}

export interface WorkspacePerson {
  id: string
  kind: "member" | "invitation"
  name: string
  email: string
  image: string | null
  role: WorkspaceRole
  activityAt: string | null
  status: "active" | "pending" | "expired"
  isCurrentUser: boolean
}

export interface WorkspaceDetail {
  id: string
  slug: string
  name: string
  logo: string | null
  role: WorkspaceRole
  plan: EntitlementPlan
  planLabel: string
  accessState: WorkspaceAccessState
  billingStatus: string
  billingSource: string | null
  seatCapacity: number | null
  usedSeats: number
  sourceCapacity: number | null
  feedCount: number
  people: Array<WorkspacePerson>
  currentPeriodEnd: string | null
  openBillingRequest: TeamRequestSummary | null
}

async function requestContext() {
  const { auth } = await import("@/lib/auth")
  const { getRequestHeaders } = await import("@tanstack/react-start/server")
  const headers = getRequestHeaders()
  const current = await auth.api.getSession({ headers })
  if (!current) throw new Error("Sign in to manage workspaces.")
  return { auth, headers, current }
}

function activeOrganizationId(
  current: Awaited<ReturnType<typeof requestContext>>["current"]
) {
  return (
    current.session as typeof current.session & {
      activeOrganizationId?: string | null
    }
  ).activeOrganizationId
}

async function countFeeds(workspaceId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(feeds)
    .where(eq(feeds.workspaceId, workspaceId))
  return Number(row?.count ?? 0)
}

async function countMembers(organizationId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(member)
    .where(eq(member.organizationId, organizationId))
  return Number(row?.count ?? 0)
}

async function countPendingInvitations(
  organizationId: string
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(invitation)
    .where(
      and(
        eq(invitation.organizationId, organizationId),
        eq(invitation.status, "pending"),
        gt(invitation.expiresAt, new Date())
      )
    )
  return Number(row?.count ?? 0)
}

function requestSummary(
  row: typeof billingRequests.$inferSelect
): TeamRequestSummary {
  return {
    id: row.id,
    type: row.requestType,
    workspaceName: row.workspaceName || row.company,
    expectedSeats: row.expectedSeats,
    requestedPlan: row.requestedPlan,
    workspaceId: row.workspaceId,
    status: row.status as TeamRequestStatus,
    decisionNote: row.decisionNote,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export const getWorkspaceOverview = createServerFn({ method: "GET" }).handler(
  async () => {
    const { current } = await requestContext()
    const principal = {
      type: "session" as const,
      userId: current.user.id,
      emailVerified: current.user.emailVerified,
      workspaceId: current.user.id,
      demo: false as const,
    }
    const personalEntitlements = await resolveEntitlements(
      personalWorkspaceRef(current.user.id),
      principal
    )
    const memberships = await db
      .select({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        logo: organization.logo,
        role: member.role,
      })
      .from(member)
      .innerJoin(organization, eq(member.organizationId, organization.id))
      .where(eq(member.userId, current.user.id))
      .orderBy(organization.name)

    const teams = await Promise.all(
      memberships.map(async (membership): Promise<WorkspaceSummary> => {
        const entitlements = await resolveEntitlements(
          organizationWorkspaceRef(membership.id),
          { ...principal, workspaceId: membership.id }
        )
        const [memberCount, pendingInvitations, feedCount] = await Promise.all([
          countMembers(membership.id),
          countPendingInvitations(membership.id),
          countFeeds(membership.id),
        ])
        return {
          id: membership.id,
          type: "organization",
          slug: membership.slug,
          name: membership.name,
          logo: membership.logo,
          role: normalizeWorkspaceRole(membership.role),
          plan: entitlements.plan,
          planLabel: workspacePlanLabel(entitlements.plan, true),
          accessState: entitlements.accessState,
          memberCount,
          pendingInvitations,
          feedCount,
          isActive: activeOrganizationId(current) === membership.id,
        }
      })
    )

    const [latestRequest] = await db
      .select()
      .from(billingRequests)
      .where(
        and(
          eq(billingRequests.requesterUserId, current.user.id),
          eq(billingRequests.requestType, "create_workspace")
        )
      )
      .orderBy(desc(billingRequests.createdAt))
      .limit(1)

    const edition = sparkfeedEdition()
    return {
      workspaces: [
        {
          id: current.user.id,
          type: "personal" as const,
          slug: "personal",
          name: personalWorkspaceName(current.user.name),
          logo: current.user.image ?? null,
          role: "owner" as const,
          plan: personalEntitlements.plan,
          planLabel: workspacePlanLabel(personalEntitlements.plan, false),
          accessState: personalEntitlements.accessState,
          memberCount: 1,
          pendingInvitations: 0,
          feedCount: await countFeeds(current.user.id),
          isActive: !activeOrganizationId(current),
        },
        ...teams,
      ],
      edition,
      canCreateWorkspace:
        edition === "community"
          ? await canUserCreateWorkspace(current.user.id)
          : false,
      activeRequest:
        latestRequest &&
        (latestRequest.status === "pending" ||
          latestRequest.status === "in_review")
          ? requestSummary(latestRequest)
          : null,
      latestRequest: latestRequest ? requestSummary(latestRequest) : null,
    }
  }
)

async function membershipFor(
  userId: string,
  organizationId: string
): Promise<{ id: string; role: WorkspaceRole }> {
  const [row] = await db
    .select({ id: member.id, role: member.role })
    .from(member)
    .where(
      and(eq(member.userId, userId), eq(member.organizationId, organizationId))
    )
    .limit(1)
  if (!row) throw new Error("You do not have access to this workspace.")
  return { id: row.id, role: normalizeWorkspaceRole(row.role) }
}

async function organizationBySlug(slug: string) {
  const [row] = await db
    .select()
    .from(organization)
    .where(eq(organization.slug, slug))
    .limit(1)
  if (!row) throw new Error("Workspace not found.")
  return row
}

async function activeBillingRequest(organizationId: string) {
  const [row] = await db
    .select()
    .from(billingRequests)
    .where(
      and(
        eq(billingRequests.workspaceId, organizationId),
        or(
          eq(billingRequests.status, "pending"),
          eq(billingRequests.status, "in_review")
        )
      )
    )
    .orderBy(desc(billingRequests.createdAt))
    .limit(1)
  return row ? requestSummary(row) : null
}

export const getWorkspaceDetail = createServerFn({ method: "GET" })
  .validator(z.string().trim().min(1))
  .handler(async ({ data: slug }): Promise<WorkspaceDetail> => {
    if (slug === "personal") {
      throw new Error("Personal billing uses the personal workspace page.")
    }
    const { current } = await requestContext()
    const org = await organizationBySlug(slug)
    const membership = await membershipFor(current.user.id, org.id)
    if (!canManageWorkspace(membership.role)) {
      throw new Error("Only workspace owners and admins can manage settings.")
    }

    const entitlements = await resolveEntitlements(
      organizationWorkspaceRef(org.id),
      {
        type: "session",
        userId: current.user.id,
        emailVerified: current.user.emailVerified,
        workspaceId: org.id,
        demo: false,
      }
    )
    const memberRows = await db
      .select({
        id: member.id,
        userId: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        role: member.role,
        createdAt: member.createdAt,
      })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(eq(member.organizationId, org.id))
      .orderBy(user.name)

    const members = await Promise.all(
      memberRows.map(async (row): Promise<WorkspacePerson> => {
        const [activity] = await db
          .select({ updatedAt: session.updatedAt })
          .from(session)
          .where(eq(session.userId, row.userId))
          .orderBy(desc(session.updatedAt))
          .limit(1)
        return {
          id: row.id,
          kind: "member",
          name: row.name,
          email: row.email,
          image: row.image,
          role: normalizeWorkspaceRole(row.role),
          activityAt:
            activity?.updatedAt?.toISOString() ??
            row.createdAt?.toISOString() ??
            null,
          status: "active",
          isCurrentUser: row.userId === current.user.id,
        }
      })
    )
    const invitationRows = await db
      .select()
      .from(invitation)
      .where(
        and(
          eq(invitation.organizationId, org.id),
          eq(invitation.status, "pending")
        )
      )
      .orderBy(desc(invitation.createdAt))
    const now = new Date()
    const invitations: Array<WorkspacePerson> = invitationRows.map((row) => ({
      id: row.id,
      kind: "invitation",
      name: row.email.split("@")[0],
      email: row.email,
      image: null,
      role: normalizeWorkspaceRole(row.role || "editor"),
      activityAt: row.createdAt?.toISOString() ?? null,
      status: row.expiresAt <= now ? "expired" : "pending",
      isCurrentUser: false,
    }))
    const [feedCount, subscription] = await Promise.all([
      countFeeds(org.id),
      db
        .select()
        .from(workspaceSubscriptions)
        .where(
          and(
            eq(workspaceSubscriptions.workspaceType, "organization"),
            eq(workspaceSubscriptions.workspaceId, org.id)
          )
        )
        .limit(1)
        .then((rows) => rows[0] ?? null),
    ])

    return {
      id: org.id,
      slug: org.slug,
      name: org.name,
      logo: org.logo ?? null,
      role: membership.role,
      plan: entitlements.plan,
      planLabel: workspacePlanLabel(entitlements.plan, true),
      accessState: entitlements.accessState,
      billingStatus: entitlements.billingStatus,
      billingSource: subscription?.billingSource ?? null,
      seatCapacity: entitlements.seatCapacity,
      usedSeats:
        members.length +
        invitations.filter((row) => row.status === "pending").length,
      sourceCapacity: entitlements.sourceUnitCapacity,
      feedCount,
      people: [...members, ...invitations],
      currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
      openBillingRequest: await activeBillingRequest(org.id),
    }
  })

const workspaceIdentitySchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().trim().min(2).max(80),
  slug: z
    .string()
    .trim()
    .min(3)
    .max(48)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .refine((value) => value !== "personal", "This slug is reserved."),
  logo: z
    .string()
    .max(1_500_000)
    .refine(
      (value) =>
        value === "" || /^data:image\/(png|jpeg|webp);base64,/.test(value),
      "Use a PNG, JPG, or WebP image."
    ),
})

export const updateWorkspaceIdentity = createServerFn({ method: "POST" })
  .validator(workspaceIdentitySchema)
  .handler(async ({ data }) => {
    const { current } = await requestContext()
    const membership = await membershipFor(current.user.id, data.organizationId)
    if (!canManageWorkspace(membership.role)) throw new Error("Not allowed.")
    const [duplicate] = await db
      .select({ id: organization.id })
      .from(organization)
      .where(
        and(
          eq(organization.slug, data.slug),
          ne(organization.id, data.organizationId)
        )
      )
      .limit(1)
    if (duplicate) throw new Error("That workspace URL is already in use.")
    await db
      .update(organization)
      .set({ name: data.name, slug: data.slug, logo: data.logo || null })
      .where(eq(organization.id, data.organizationId))
    return { slug: data.slug }
  })

const teamRequestSchema = z.object({
  workspaceName: z.string().trim().min(2).max(80),
  expectedSeats: z.number().int().min(2).max(500),
  message: z.string().trim().max(2000),
})

export const submitTeamWorkspaceRequest = createServerFn({ method: "POST" })
  .validator(teamRequestSchema)
  .handler(async ({ data }) => {
    const { current } = await requestContext()
    if (sparkfeedEdition() !== "cloud") {
      throw new Error("Community instances create workspaces directly.")
    }
    if (!current.user.emailVerified) {
      throw new Error("Verify your email before requesting a team workspace.")
    }
    const [existing] = await db
      .select({ id: billingRequests.id })
      .from(billingRequests)
      .where(
        and(
          eq(billingRequests.requesterUserId, current.user.id),
          eq(billingRequests.requestType, "create_workspace"),
          or(
            eq(billingRequests.status, "pending"),
            eq(billingRequests.status, "in_review")
          )
        )
      )
      .limit(1)
    if (existing) throw new Error("You already have an active team request.")
    const now = new Date().toISOString()
    const id = randomUUID()
    await db.insert(billingRequests).values({
      id,
      name: current.user.name,
      email: current.user.email,
      company: data.workspaceName,
      message: data.message,
      requesterUserId: current.user.id,
      requestType: "create_workspace",
      workspaceName: data.workspaceName,
      expectedSeats: data.expectedSeats,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    })
    try {
      await sendTeamRequestNotification({
        requesterName: current.user.name,
        requesterEmail: current.user.email,
        workspaceName: data.workspaceName,
        requestType: "create_workspace",
        expectedSeats: data.expectedSeats,
        message: data.message,
      })
    } catch (error) {
      console.error("[workspace-request] notification failed", error)
    }
    return { id, status: "pending" as const }
  })

async function managedOrganizationContext(organizationId: string) {
  const context = await requestContext()
  const membership = await membershipFor(
    context.current.user.id,
    organizationId
  )
  if (!canManageWorkspace(membership.role)) throw new Error("Not allowed.")
  return { ...context, membership }
}

async function invitationCapacity(organizationId: string, userId: string) {
  const entitlements = await resolveEntitlements(
    organizationWorkspaceRef(organizationId),
    {
      type: "session",
      userId,
      emailVerified: true,
      workspaceId: organizationId,
      demo: false,
    }
  )
  if (!entitlements.canManageInvitations) {
    throw new Error("This workspace plan does not include invitations.")
  }
  if (entitlements.seatCapacity === null) return
  const used =
    (await countMembers(organizationId)) +
    (await countPendingInvitations(organizationId))
  if (used >= entitlements.seatCapacity) {
    throw new Error("This workspace has no available seats.")
  }
}

const invitationInput = z.object({
  organizationId: z.string().min(1),
  email: z.email(),
  role: z.enum(["admin", "editor"]),
})

export const inviteWorkspaceMember = createServerFn({ method: "POST" })
  .validator(invitationInput)
  .handler(async ({ data }) => {
    const { auth, headers, current, membership } =
      await managedOrganizationContext(data.organizationId)
    if (membership.role === "admin" && data.role !== "editor") {
      throw new Error("Admins can invite Editors only.")
    }
    await invitationCapacity(data.organizationId, current.user.id)
    await auth.api.createInvitation({
      headers,
      body: {
        organizationId: data.organizationId,
        email: data.email.toLowerCase(),
        role: data.role,
      },
    })
    return { success: true }
  })

async function invitationForAction(invitationId: string) {
  const [row] = await db
    .select()
    .from(invitation)
    .where(eq(invitation.id, invitationId))
    .limit(1)
  if (!row) throw new Error("Invitation not found.")
  const context = await managedOrganizationContext(row.organizationId)
  const role = normalizeWorkspaceRole(row.role || "editor")
  if (context.membership.role === "admin" && role !== "editor") {
    throw new Error("Only the Owner can manage Admin invitations.")
  }
  return { row, context, role }
}

export const resendWorkspaceInvitation = createServerFn({ method: "POST" })
  .validator(z.object({ invitationId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { row, context, role } = await invitationForAction(data.invitationId)
    await context.auth.api.createInvitation({
      headers: context.headers,
      body: {
        organizationId: row.organizationId,
        email: row.email,
        role,
        resend: true,
      },
    })
    return { success: true }
  })

export const cancelWorkspaceInvitation = createServerFn({ method: "POST" })
  .validator(z.object({ invitationId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { context } = await invitationForAction(data.invitationId)
    await context.auth.api.cancelInvitation({
      headers: context.headers,
      body: { invitationId: data.invitationId },
    })
    return { success: true }
  })

const memberActionInput = z.object({
  organizationId: z.string().min(1),
  memberId: z.string().min(1),
})

async function targetMember(organizationId: string, memberId: string) {
  const [row] = await db
    .select({ id: member.id, userId: member.userId, role: member.role })
    .from(member)
    .where(
      and(eq(member.id, memberId), eq(member.organizationId, organizationId))
    )
    .limit(1)
  if (!row) throw new Error("Member not found.")
  return { ...row, role: normalizeWorkspaceRole(row.role) }
}

export const updateWorkspaceMemberRole = createServerFn({ method: "POST" })
  .validator(memberActionInput.extend({ role: z.enum(["admin", "editor"]) }))
  .handler(async ({ data }) => {
    const { current, membership } = await managedOrganizationContext(
      data.organizationId
    )
    const target = await targetMember(data.organizationId, data.memberId)
    if (target.userId === current.user.id) {
      throw new Error("Use Leave workspace to change your own access.")
    }
    if (target.role === "owner") {
      throw new Error("Transfer ownership before changing the Owner.")
    }
    if (
      membership.role === "admin" &&
      (target.role !== "editor" || data.role !== "editor")
    ) {
      throw new Error("Admins can manage Editors only.")
    }
    await db
      .update(member)
      .set({ role: data.role })
      .where(eq(member.id, data.memberId))
    return { success: true }
  })

export const transferWorkspaceOwnership = createServerFn({ method: "POST" })
  .validator(memberActionInput)
  .handler(async ({ data }) => {
    const { current, membership } = await managedOrganizationContext(
      data.organizationId
    )
    if (!canManageBilling(membership.role)) {
      throw new Error("Only the Owner can transfer ownership.")
    }
    const target = await targetMember(data.organizationId, data.memberId)
    if (target.userId === current.user.id) return { success: true }
    await db.transaction(async (tx) => {
      await tx
        .update(member)
        .set({ role: "admin" })
        .where(
          and(
            eq(member.organizationId, data.organizationId),
            eq(member.role, "owner")
          )
        )
      await tx
        .update(member)
        .set({ role: "owner" })
        .where(eq(member.id, target.id))
    })
    return { success: true }
  })

export const removeWorkspaceMember = createServerFn({ method: "POST" })
  .validator(memberActionInput)
  .handler(async ({ data }) => {
    const { auth, headers, current, membership } =
      await managedOrganizationContext(data.organizationId)
    const target = await targetMember(data.organizationId, data.memberId)
    if (target.userId === current.user.id) {
      throw new Error("Use Leave workspace to remove yourself.")
    }
    if (target.role === "owner") throw new Error("The Owner cannot be removed.")
    if (membership.role === "admin" && target.role !== "editor") {
      throw new Error("Admins can remove Editors only.")
    }
    await auth.api.removeMember({
      headers,
      body: {
        organizationId: data.organizationId,
        memberIdOrEmail: data.memberId,
      },
    })
    return { success: true }
  })

export const leaveWorkspace = createServerFn({ method: "POST" })
  .validator(z.object({ organizationId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { auth, headers, current } = await requestContext()
    const membership = await membershipFor(current.user.id, data.organizationId)
    if (membership.role === "owner") {
      throw new Error("Transfer ownership before leaving this workspace.")
    }
    await auth.api.leaveOrganization({
      headers,
      body: { organizationId: data.organizationId },
    })
    return { success: true }
  })

const planRequestInput = z.object({
  organizationId: z.string().min(1),
  requestType: z.enum(["change_plan", "cancel_plan"]),
  expectedSeats: z.number().int().min(1).max(500).nullable(),
  message: z.string().trim().max(2000),
})

export const submitWorkspacePlanRequest = createServerFn({ method: "POST" })
  .validator(planRequestInput)
  .handler(async ({ data }) => {
    const { current, membership } = await managedOrganizationContext(
      data.organizationId
    )
    if (!canManageBilling(membership.role)) {
      throw new Error("Only the Owner can manage billing.")
    }
    const [org] = await db
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, data.organizationId))
      .limit(1)
    if (!org) throw new Error("Workspace not found.")
    if (await activeBillingRequest(data.organizationId)) {
      throw new Error("This workspace already has an open billing request.")
    }
    const now = new Date().toISOString()
    const id = randomUUID()
    await db.insert(billingRequests).values({
      id,
      name: current.user.name,
      email: current.user.email,
      company: org.name,
      message: data.message,
      requesterUserId: current.user.id,
      requestType: data.requestType,
      workspaceName: org.name,
      expectedSeats: data.expectedSeats,
      workspaceId: data.organizationId,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    })
    try {
      await sendTeamRequestNotification({
        requesterName: current.user.name,
        requesterEmail: current.user.email,
        workspaceName: org.name,
        requestType: data.requestType,
        expectedSeats: data.expectedSeats,
        message: data.message,
      })
    } catch (error) {
      console.error("[workspace-request] notification failed", error)
    }
    return { id, status: "pending" as const }
  })

export const deleteWorkspace = createServerFn({ method: "POST" })
  .validator(
    z.object({
      organizationId: z.string().min(1),
      confirmation: z.string().min(1),
    })
  )
  .handler(async ({ data }) => {
    const { membership } = await managedOrganizationContext(data.organizationId)
    if (!canManageBilling(membership.role)) {
      throw new Error("Only the Owner can delete this workspace.")
    }
    const [org] = await db
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, data.organizationId))
      .limit(1)
    if (!org) throw new Error("Workspace not found.")
    if (data.confirmation !== org.name) {
      throw new Error("Enter the workspace name exactly.")
    }
    const [subscription] = await db
      .select({
        plan: workspaceSubscriptions.planKey,
        status: workspaceSubscriptions.subscriptionStatus,
      })
      .from(workspaceSubscriptions)
      .where(
        and(
          eq(workspaceSubscriptions.workspaceType, "organization"),
          eq(workspaceSubscriptions.workspaceId, data.organizationId)
        )
      )
      .limit(1)
    if (
      subscription &&
      (subscription.plan === "pro" || subscription.plan === "enterprise") &&
      subscription.status !== "canceled"
    ) {
      throw new Error("Cancel the team plan before deleting this workspace.")
    }
    await deleteOrganizationWorkspaceData(db, data.organizationId)
    return { success: true }
  })
