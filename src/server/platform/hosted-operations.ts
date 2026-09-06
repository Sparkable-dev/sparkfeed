import { randomUUID } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { APIError } from "better-auth/api"
import type { Database } from "@/db/client"
import { db } from "@/db/index"
import {
  member,
  organization,
  platformAdminAuditLog,
  session,
  user,
  workspaceSubscriptions,
} from "@/db/schema"
import {
  deleteOrganizationWorkspaceData,
  deletePersonalWorkspaceData,
  hasManagedPersonalPlusSubscription,
  ownedWorkspacesForUser,
} from "@/server/account-deletion"

import { readEffectiveSubscription } from "@/server/entitlements/effective"

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
async function audit(
  tx: Tx,
  action: string,
  target: string,
  before: unknown,
  after: unknown,
  actor?: { userId: string; email: string; reason: string }
) {
  await tx.insert(platformAdminAuditLog).values({
    id: randomUUID(),
    actorUserId: actor?.userId ?? "integration:better-auth-dashboard",
    action,
    targetType: "hosted_auth",
    targetId: target,
    reason: actor?.reason ?? "Authenticated hosted dashboard operation",
    beforeState: JSON.stringify(before),
    afterState: JSON.stringify(after),
    createdAt: new Date().toISOString(),
  })
}

export async function deleteHostedUsers(ids: Array<string>) {
  return db.transaction(async (tx) => {
    for (const id of [...new Set(ids)].sort()) {
      const [account] = await tx
        .select({ id: user.id, email: user.email })
        .from(user)
        .where(eq(user.id, id))
        .for("update")
        .limit(1)
      if (!account) continue
      const database = tx as unknown as Database
      if (
        (await hasManagedPersonalPlusSubscription(database, id)) ||
        (await ownedWorkspacesForUser(database, id)).length
      )
        throw new APIError("FORBIDDEN", {
          message:
            "Cancel the subscription and resolve workspace ownership before deleting this account.",
        })
      await deletePersonalWorkspaceData(database, id)
      await tx.delete(user).where(eq(user.id, id))
      await audit(tx, "delete_user", id, account, { deleted: true })
    }
    return { success: true, deletedUserIds: ids, skippedUserIds: [] }
  })
}

export async function deleteHostedOrganizations(ids: Array<string>) {
  return db.transaction(async (tx) => {
    for (const id of [...new Set(ids)].sort()) {
      const [org] = await tx
        .select()
        .from(organization)
        .where(eq(organization.id, id))
        .for("update")
        .limit(1)
      if (!org) continue
      const [billing] = await tx
        .select()
        .from(workspaceSubscriptions)
        .where(
          and(
            eq(workspaceSubscriptions.workspaceType, "organization"),
            eq(workspaceSubscriptions.workspaceId, id)
          )
        )
        .limit(1)
      if (billing && billing.subscriptionStatus !== "canceled")
        throw new APIError("FORBIDDEN", {
          message: "End this workspace plan before deleting the workspace.",
        })
      await deleteOrganizationWorkspaceData(tx, id)
      await audit(
        tx,
        "delete_organization",
        id,
        { name: org.name },
        { deleted: true }
      )
    }
    return { success: true, deletedOrgIds: ids, skippedOrgIds: [] }
  })
}

export async function hostedMembership(
  orgId: string,
  command:
    | { action: "add"; userId: string; role: string }
    | { action: "remove"; memberId: string }
    | { action: "role"; memberId: string; role: string },
  actor?: { userId: string; email: string; reason: string }
) {
  return db.transaction(async (tx) => {
    const [org] = await tx
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, orgId))
      .for("update")
      .limit(1)
    if (!org)
      throw new APIError("NOT_FOUND", { message: "Workspace not found" })
    if (
      "role" in command &&
      !["owner", "admin", "editor"].includes(command.role)
    )
      throw new APIError("BAD_REQUEST", {
        message: "Choose Owner, Admin, or Editor.",
      })
    if (command.action === "add") {
      const access = await readEffectiveSubscription(
        tx,
        { type: "organization", id: orgId },
        new Date(),
        true
      )
      if (!access || access.accessState !== "active")
        throw new APIError("FORBIDDEN", {
          message: "Restore workspace access before adding members.",
        })
      if (command.role === "owner")
        throw new APIError("BAD_REQUEST", {
          message: "Add the person first, then transfer ownership.",
        })
      const [existing] = await tx
        .select()
        .from(member)
        .where(
          and(
            eq(member.organizationId, orgId),
            eq(member.userId, command.userId)
          )
        )
        .limit(1)
      if (existing) return existing
      const [added] = await tx
        .insert(member)
        .values({
          id: randomUUID(),
          organizationId: orgId,
          userId: command.userId,
          role: command.role,
          createdAt: new Date(),
        })
        .returning()
      await audit(
        tx,
        "add_member",
        orgId,
        null,
        {
          userId: command.userId,
          role: command.role,
        },
        actor
      )
      return added
    }
    const [target] = await tx
      .select()
      .from(member)
      .where(
        and(eq(member.organizationId, orgId), eq(member.id, command.memberId))
      )
      .limit(1)
    if (!target)
      throw new APIError("NOT_FOUND", { message: "Member not found" })
    if (command.action === "remove") {
      if (target.role === "owner")
        throw new APIError("FORBIDDEN", {
          message: "Transfer ownership before removing the owner.",
        })
      await tx.delete(member).where(eq(member.id, target.id))
      await tx
        .update(session)
        .set({ activeOrganizationId: null })
        .where(
          and(
            eq(session.userId, target.userId),
            eq(session.activeOrganizationId, orgId)
          )
        )
      await audit(
        tx,
        "remove_member",
        orgId,
        { userId: target.userId, role: target.role },
        { removed: true },
        actor
      )
      return { success: true }
    }
    if (target.role === "owner" && command.role !== "owner")
      throw new APIError("FORBIDDEN", {
        message: "Choose the new owner to transfer ownership atomically.",
      })
    if (command.role === "owner" && target.role !== "owner")
      await tx
        .update(member)
        .set({ role: "admin" })
        .where(and(eq(member.organizationId, orgId), eq(member.role, "owner")))
    const [changed] = await tx
      .update(member)
      .set({ role: command.role })
      .where(eq(member.id, target.id))
      .returning()
    await audit(
      tx,
      command.role === "owner" ? "transfer_ownership" : "update_member_role",
      orgId,
      { userId: target.userId, role: target.role },
      { userId: target.userId, role: command.role },
      actor
    )
    return changed
  })
}

export async function createHostedOrganization(
  ownerId: string,
  input: { name: string; slug: string; logo?: string | null }
) {
  return db.transaction(async (tx) => {
    const [owner] = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, ownerId))
      .limit(1)
    if (!owner) throw new APIError("NOT_FOUND", { message: "Owner not found" })
    const id = randomUUID(),
      now = new Date()
    const [org] = await tx
      .insert(organization)
      .values({
        id,
        name: input.name,
        slug: input.slug,
        logo: input.logo,
        createdAt: now,
      })
      .returning()
    await tx.insert(workspaceSubscriptions).values({
      workspaceType: "organization",
      workspaceId: id,
      planKey: "pro",
      billingSource: "manual",
      subscriptionStatus: "active",
      accessState: "active",
      paidSeatQuantity: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    })
    const [ownerMember] = await tx
      .insert(member)
      .values({
        id: randomUUID(),
        organizationId: id,
        userId: ownerId,
        role: "owner",
        createdAt: now,
      })
      .returning()
    await audit(tx, "create_organization", id, null, {
      name: org.name,
      ownerId,
      plan: "pro",
      seats: 1,
      billingSource: "manual",
    })
    return { ...org, members: [ownerMember] }
  })
}

export async function recordHostedAction(action: string, target: string) {
  await db.transaction((tx) =>
    audit(tx, action, target, null, { status: "completed" })
  )
}
