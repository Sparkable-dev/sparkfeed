import { and, asc, eq, gt, sql } from "drizzle-orm"
import type { RegistrationDecision } from "@/lib/community-policy"
import { db } from "@/db/index"
import { invitation, user } from "@/db/schema"
import {
  decideRegistration,
  decideWorkspaceCreation,
  readWorkspaceCreationPolicy,
} from "@/lib/community-policy"
import { sparkfeedEdition } from "@/server/entitlements/config"

export { readWorkspaceCreationPolicy } from "@/lib/community-policy"

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

async function hasPendingInvite(email: string | undefined): Promise<boolean> {
  if (!email) return false

  const normalizedEmail = normalizeEmail(email)
  const now = new Date()

  const [organizationInvite] = await db
    .select({ id: invitation.id })
    .from(invitation)
    .where(
      and(
        sql`lower(${invitation.email}) = ${normalizedEmail}`,
        eq(invitation.status, "pending"),
        gt(invitation.expiresAt, now)
      )
    )
    .limit(1)

  return Boolean(organizationInvite)
}

async function userCount(): Promise<number> {
  const [result] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(user)

  return result?.count ?? 0
}

export async function registrationDecision(
  email?: string
): Promise<RegistrationDecision> {
  if (sparkfeedEdition() === "cloud") {
    return { allowed: true, reason: "open" }
  }

  const openRegistration = process.env.ALLOW_REGISTRATION === "true"
  const count = await userCount()

  return decideRegistration({
    openRegistration,
    userCount: count,
    invited: await hasPendingInvite(email),
  })
}

export async function isInstanceOwner(userId: string): Promise<boolean> {
  const [owner] = await db
    .select({ id: user.id })
    .from(user)
    .orderBy(asc(user.createdAt), asc(user.id))
    .limit(1)

  return owner?.id === userId
}

export async function canUserCreateWorkspace(userId: string): Promise<boolean> {
  if (sparkfeedEdition() === "cloud") return false

  const policy = readWorkspaceCreationPolicy()
  if (policy === "all-users") return true

  return decideWorkspaceCreation({
    policy,
    isInstanceOwner: await isInstanceOwner(userId),
  })
}
