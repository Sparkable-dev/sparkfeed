import { createServerOnlyFn } from "@tanstack/react-start"
import type { WorkspaceRef } from "@/server/entitlements/types"
import { DEMO_MODE, DEMO_WORKSPACE_ID } from "@/lib/demo"
import { personalWorkspaceRef, workspaceRefForSession } from "@/lib/workspaces"

/**
 * Who is calling, and which workspace their data lives in.
 *
 * `workspaceId` is the tenancy anchor for every query in the app. It is
 * `activeOrganizationId` when the user has an organization selected, otherwise
 * their own user id (the "personal workspace"). That fallback is why a personal
 * workspace has no `organization` row and why anything keyed off an org id
 * breaks for solo users.
 *
 * `null` means unauthenticated. It is a real value, not an error: rows written
 * before auth existed have `workspace_id IS NULL`, and the query helpers in
 * `tenancy.ts` deliberately match those rather than matching everything.
 */
export interface WorkspaceContext {
  workspaceId: string | null
  workspace: WorkspaceRef | null
  userId: string | null
  emailVerified: boolean
  demo: boolean
}

/**
 * Resolves the caller from the ambient request headers.
 *
 * Wrapped in `createServerOnlyFn` because this is a plain module, unlike the
 * `createServerFn` handlers that used to inline this logic. Those handler
 * bodies are replaced by an RPC call in the client build, so their server-only
 * imports disappear; a standalone module keeps them, and TanStack's import
 * protection rejects the build. The wrapper marks the boundary explicitly and
 * throws if it is ever reached from the client.
 *
 * `@/lib/auth` and `@tanstack/react-start/server` stay dynamic imports on top
 * of that, matching the convention in `rss.ts` and `email-actions.ts`.
 *
 * In demo mode there is no session at all (no cookie, no `session` row, and
 * `ensureDemoSchema` never creates better-auth's tables), so calling
 * `auth.api.getSession` there would query a table that does not exist. The
 * demo branch must come first.
 */
export const resolveWorkspaceContext = createServerOnlyFn(
  async (
    options: { allowSuspended?: boolean } = {}
  ): Promise<WorkspaceContext> => {
    if (DEMO_MODE) {
      return {
        workspaceId: DEMO_WORKSPACE_ID,
        workspace: personalWorkspaceRef(DEMO_WORKSPACE_ID),
        userId: DEMO_WORKSPACE_ID,
        emailVerified: false,
        demo: true,
      }
    }

    const { getRequestHeaders } = await import("@tanstack/react-start/server")
    return resolveWorkspaceContextFromHeaders(getRequestHeaders(), options)
  }
)

/**
 * Same resolution, for callers that already hold the request.
 *
 * File-route server handlers (`createFileRoute(...).server.handlers`) are given
 * a `request` directly and do not run inside the ambient store that
 * `getRequestHeaders()` reads, so they must pass headers explicitly rather than
 * calling `resolveWorkspaceContext`.
 *
 * The demo branch is repeated here rather than delegated, because it must come
 * before any use of `auth` — see the note above.
 */
export const resolveWorkspaceContextFromHeaders = createServerOnlyFn(
  async (
    headers: Headers,
    options: { allowSuspended?: boolean } = {}
  ): Promise<WorkspaceContext> => {
    if (DEMO_MODE) {
      return {
        workspaceId: DEMO_WORKSPACE_ID,
        workspace: personalWorkspaceRef(DEMO_WORKSPACE_ID),
        userId: DEMO_WORKSPACE_ID,
        emailVerified: false,
        demo: true,
      }
    }

    const { auth } = await import("@/lib/auth")
    const session = await auth.api.getSession({ headers })

    const organizationId = session?.session
      ? "activeOrganizationId" in session.session
        ? ((session.session.activeOrganizationId as
            string | null | undefined) ?? null)
        : null
      : null
    const userId = session?.user?.id ?? null
    const workspace = userId
      ? workspaceRefForSession(userId, organizationId)
      : null

    if (workspace && userId && !options.allowSuspended) {
      const { workspaceIsSuspended } =
        await import("@/server/entitlements/suspension")
      if (await workspaceIsSuspended(workspace.id))
        throw new Error(
          "This workspace is suspended. Switch to another workspace or contact support."
        )
    }

    const supportSession =
      session?.session &&
      "impersonatedBy" in session.session &&
      session.session.impersonatedBy
    if (userId && workspace && !supportSession) {
      const { recordPlatformActivity } =
        await import("@/server/platform/activity")
      await recordPlatformActivity(userId, workspace)
    }

    return {
      workspaceId: workspace?.id ?? null,
      workspace,
      userId,
      emailVerified: session?.user?.emailVerified === true,
      demo: false,
    }
  }
)

/** Convenience for the common case where only the anchor is needed. */
export async function resolveWorkspaceId(): Promise<string | null> {
  return (await resolveWorkspaceContext()).workspaceId
}
