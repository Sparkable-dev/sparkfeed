import { createRouter as createTanStackRouter } from "@tanstack/react-router"
import { QueryClient } from "@tanstack/react-query"
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query"
import { routeTree } from "./routeTree.gen"
import { RouteError } from "./components/RouteError"
import { RouteNotFound } from "./components/RouteNotFound"

export function getRouter() {
  // Never share query data across server requests or signed-in users.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  })
  const router = createTanStackRouter({
    routeTree,
    context: { queryClient },

    // Without this, any loader rejection renders TanStack's built-in panel,
    // which prints the raw error. A failing article query once blanked the
    // entire app that way.
    defaultErrorComponent: RouteError,

    // Same reason. Without this a `notFound()` — or any URL that matches no
    // route — renders the router's built-in fallback, which is the words "Not
    // Found" on an otherwise empty page with no way back.
    defaultNotFoundComponent: RouteNotFound,

    scrollRestoration: true,
    defaultPreload: "intent",

    /*
      Was 0, which quietly turned preloading off.

      `defaultPreload: "intent"` runs a route's loader when the pointer settles
      on its link, so the data is ready by the time it is clicked. A
      `preloadStaleTime` of 0 marks that result stale the instant it lands, so
      the click threw it away and ran the whole loader again — every page paid
      full price for its data *and* fetched it twice. Every route here loads the
      sidebar's folders, feeds and article counts, which is the bulk of that
      cost.

      30s is the library's own default and the right shape for this: long enough
      that a hover reliably covers the click, short enough that a page opened
      from a link is never showing anything close to old. Mutations do not rely
      on it either way — they call `invalidateWorkspace(router)`, which drops cached
      matches regardless of how fresh they claim to be.
    */
    defaultPreloadStaleTime: 30_000,
  })

  setupRouterSsrQueryIntegration({ router, queryClient })
  return router
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
