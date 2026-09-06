import { createMiddleware, createServerOnlyFn } from "@tanstack/react-start"
import type { WorkspaceContext } from "@/server/services/context"

export const assertWorkspaceWritable = createServerOnlyFn(
  async (context: WorkspaceContext) => {
    if (context.demo) return
    if (!context.workspace || !context.userId || !context.workspaceId)
      throw new Error("Sign in to change workspace content.")
    const { resolveEntitlements } = await import("./resolve")
    const entitlements = await resolveEntitlements(context.workspace, {
      type: "session",
      userId: context.userId,
      emailVerified: context.emailVerified,
      workspaceId: context.workspaceId,
      demo: false,
    })
    if (entitlements.accessState !== "active")
      throw new Error("This workspace is read-only or suspended.")
    if (context.workspace.type === "organization") {
      const [{ db }, { member }, { and, eq }] = await Promise.all([
        import("@/db/index"),
        import("@/db/schema"),
        import("drizzle-orm"),
      ])
      const [membership] = await db
        .select({ role: member.role })
        .from(member)
        .where(
          and(
            eq(member.organizationId, context.workspace.id),
            eq(member.userId, context.userId)
          )
        )
        .limit(1)
      if (
        !membership ||
        !["owner", "admin", "editor"].includes(membership.role)
      )
        throw new Error("Workspace membership is required.")
    }
  }
)

export const workspaceWriteMiddleware = createMiddleware({
  type: "function",
}).server(async ({ next }) => {
  const { resolveWorkspaceContext } = await import("@/server/services/context")
  await assertWorkspaceWritable(await resolveWorkspaceContext())
  return next()
})
