import { Outlet, createFileRoute, redirect } from "@tanstack/react-router"
import { getSession } from "@/lib/auth.functions"
import { RouteError } from "@/components/RouteError"
import { CommandPaletteProvider } from "@/components/command/command-palette-context"
import { AddFeedProvider } from "@/components/add-feed/add-feed-context"
import { WorkspaceAccessNotice } from "@/components/WorkspaceAccessNotice"
import { WorkspaceDataProvider } from "@/components/WorkspaceDataProvider"
import { loadWorkspaceData } from "@/lib/workspace-query"

export const Route = createFileRoute("/_protected")({
  beforeLoad: async ({ location, context }) => {
    if (import.meta.env.VITE_DEMO_MODE === "true") {
      const { DEMO_SESSION } = await import("@/lib/demo")
      return {
        user: DEMO_SESSION.user,
        workspaceScope: {
          userId: DEMO_SESSION.user.id,
          workspaceId: DEMO_SESSION.user.id,
        },
      }
    }
    const session = await getSession()
    if (!session || !session.user) {
      context.queryClient.clear()
      throw redirect({
        to: "/sign-in",
        search: {
          redirect: location.href !== "/sign-in" ? location.href : undefined,
        },
      })
    }
    const organizationId =
      "activeOrganizationId" in session.session
        ? (session.session.activeOrganizationId as string | null)
        : null
    const workspaceScope = {
      userId: session.user.id,
      workspaceId: organizationId || session.user.id,
    }
    context.queryClient.removeQueries({
      predicate: (query) =>
        query.queryKey[0] === "workspace" &&
        (query.queryKey[1] !== workspaceScope.userId ||
          query.queryKey[2] !== workspaceScope.workspaceId),
    })
    return { user: session.user, workspaceScope }
  },
  loader: ({ context }) => loadWorkspaceData(context),
  /*
    The palette lives here rather than in the shell so that ⌘K state, and the
    index it has already fetched, survive navigation between routes.

    Add-sources sits inside it for two reasons: it registers its own palette
    commands, and mounting it once here is what makes "add a feed" the same
    action from the top bar, the palette, /sources, Discover and a chat card —
    it used to be three separate dialogs with three different prop sets.
  */
  component: ProtectedLayout,
  errorComponent: RouteError,
})

function ProtectedLayout() {
  const { workspaceScope } = Route.useRouteContext()
  return (
    <WorkspaceDataProvider
      value={workspaceScope}
      key={`${workspaceScope.userId}:${workspaceScope.workspaceId}`}
    >
      <CommandPaletteProvider>
        <AddFeedProvider>
          <WorkspaceAccessNotice />
          <Outlet />
        </AddFeedProvider>
      </CommandPaletteProvider>
    </WorkspaceDataProvider>
  )
}
