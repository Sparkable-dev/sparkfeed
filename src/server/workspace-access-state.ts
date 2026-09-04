import { and, eq } from "drizzle-orm"
import { createServerFn } from "@tanstack/react-start"
import type { WorkspaceAccessSnapshot } from "@/lib/workspace-access-notice"
import { db } from "@/db/index"
import { organization, workspaceSubscriptions } from "@/db/schema"
import { workspacePlanLabel } from "@/lib/workspaces"
import { resolveEntitlements } from "@/server/entitlements/resolve"
import { resolveWorkspaceContext } from "@/server/services/context"

export const getActiveWorkspaceAccessState = createServerFn({
  method: "GET",
}).handler(async (): Promise<WorkspaceAccessSnapshot | null> => {
  const context = await resolveWorkspaceContext()
  if (!context.workspace || !context.userId) return null

  const principal = context.demo
    ? ({
        type: "demo",
        userId: null,
        emailVerified: false,
        workspaceId: context.workspace.id,
        demo: true,
      } as const)
    : ({
        type: "session",
        userId: context.userId,
        emailVerified: context.emailVerified,
        workspaceId: context.workspace.id,
        demo: false,
      } as const)
  const entitlements = await resolveEntitlements(context.workspace, principal)

  let workspaceName = "Personal workspace"
  if (context.workspace.type === "organization") {
    const [row] = await db
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, context.workspace.id))
      .limit(1)
    workspaceName = row?.name ?? "Team workspace"
  }

  const [subscription] = await db
    .select({ updatedAt: workspaceSubscriptions.updatedAt })
    .from(workspaceSubscriptions)
    .where(
      and(
        eq(workspaceSubscriptions.workspaceType, context.workspace.type),
        eq(workspaceSubscriptions.workspaceId, context.workspace.id)
      )
    )
    .limit(1)

  return {
    workspaceKey: `${context.workspace.type}:${context.workspace.id}:${subscription?.updatedAt ?? "default"}`,
    workspaceName,
    plan: entitlements.plan,
    planLabel: workspacePlanLabel(
      entitlements.plan,
      context.workspace.type === "organization"
    ),
    accessState: entitlements.accessState,
    billingStatus: entitlements.billingStatus,
  }
})
