import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { getSession } from "@/lib/auth.functions";
import { RouteError } from "@/components/RouteError";
import { CommandPaletteProvider } from "@/components/command/command-palette-context";
import { AddFeedProvider } from "@/components/add-feed/add-feed-context";

export const Route = createFileRoute("/_protected")({
  beforeLoad: async ({ location }) => {
    if (import.meta.env.VITE_DEMO_MODE === "true") {
      const { DEMO_SESSION } = await import("@/lib/demo")
      return { user: DEMO_SESSION.user }
    }
    const session = await getSession();
    if (!session || !session.user) {
      throw redirect({
        to: "/login",
        search: {
          redirect: location.href !== "/login" ? location.href : undefined
        },
      });
    }
    return { user: session.user };
  },
  /*
    The palette lives here rather than in the shell so that ⌘K state, and the
    index it has already fetched, survive navigation between routes.

    Add-sources sits inside it for two reasons: it registers its own palette
    commands, and mounting it once here is what makes "add a feed" the same
    action from the top bar, the palette, /sources, Discover and a chat card —
    it used to be three separate dialogs with three different prop sets.
  */
  component: () => (
    <CommandPaletteProvider>
      <AddFeedProvider>
        <Outlet />
      </AddFeedProvider>
    </CommandPaletteProvider>
  ),
  errorComponent: RouteError,
});
