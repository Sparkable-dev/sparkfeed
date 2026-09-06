import { eq } from "drizzle-orm"
import { z } from "zod"
import { workspaceInput } from "./contracts"
import { PlatformRequestError } from "./assertion"
import { changeWorkspaceOverride } from "./overrides"
import { hostedMembership } from "./hosted-operations"
import {
  activeOverride,
  readWorkspaceOverride,
} from "@/server/entitlements/effective"
import { db } from "@/db/index"
import { user } from "@/db/schema"

const actorReason = z.string().trim().min(1).max(500)
const accessInput = workspaceInput.extend({
  action: z.literal("change_workspace_access"),
  access: z.enum(["active", "read_only", "suspended"]),
  expectedRevision: z.number().int().nonnegative(),
  reason: actorReason,
})
export async function changeWorkspaceAccess(
  raw: unknown,
  actor: { userId: string; email: string }
) {
  const input = accessInput.parse(raw),
    workspace = { type: input.workspaceType, id: input.workspaceId },
    previous = activeOverride(await readWorkspaceOverride(db, workspace))
  return changeWorkspaceOverride(
    {
      ...input,
      action: "set_override",
      planKey: previous?.planKey ?? null,
      accessRestriction: input.access === "active" ? null : input.access,
      seatLimit: previous?.seatLimit ?? null,
      monthlyAiCredits: previous?.monthlyAiCredits ?? null,
      sourceUnitLimit: previous?.sourceUnitLimit ?? null,
      apiAccess: previous?.apiAccess ?? null,
      mcpAccess: previous?.mcpAccess ?? null,
      expiresAt: previous?.expiresAt ?? null,
    },
    actor,
    { auditAction: "change_workspace_access" }
  )
}
const memberInput = z.discriminatedUnion("operation", [
  z.object({
    action: z.literal("manage_workspace_member"),
    operation: z.literal("add"),
    workspaceId: z.string().min(1),
    email: z.email(),
    role: z.enum(["admin", "editor"]),
    reason: actorReason,
  }),
  z.object({
    action: z.literal("manage_workspace_member"),
    operation: z.literal("role"),
    workspaceId: z.string().min(1),
    memberId: z.string().min(1),
    role: z.enum(["owner", "admin", "editor"]),
    reason: actorReason,
  }),
  z.object({
    action: z.literal("manage_workspace_member"),
    operation: z.literal("remove"),
    workspaceId: z.string().min(1),
    memberId: z.string().min(1),
    reason: actorReason,
  }),
])
export async function manageWorkspaceMember(
  raw: unknown,
  actor: { userId: string; email: string }
) {
  const input = memberInput.parse(raw),
    auditActor = { ...actor, reason: input.reason }
  try {
    if (input.operation === "add") {
      const [account] = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, input.email.trim().toLowerCase()))
        .limit(1)
      if (!account)
        throw new PlatformRequestError(
          400,
          "No account has this email. Add an existing Sparkfeed user."
        )
      return await hostedMembership(
        input.workspaceId,
        { action: "add", userId: account.id, role: input.role },
        auditActor
      )
    }
    return await hostedMembership(
      input.workspaceId,
      input.operation === "remove"
        ? { action: "remove", memberId: input.memberId }
        : { action: "role", memberId: input.memberId, role: input.role },
      auditActor
    )
  } catch (error) {
    let cause: unknown = error
    for (let i = 0; i < 4 && cause && typeof cause === "object"; i++) {
      if ("code" in cause && cause.code === "23514")
        throw new PlatformRequestError(
          400,
          "This change exceeds available seats or would leave the workspace without one owner."
        )
      cause = "cause" in cause ? cause.cause : null
    }
    throw error
  }
}
