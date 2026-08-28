import { Outlet, createFileRoute } from "@tanstack/react-router"

/**
 * Layout only. The chat itself lives at `/dashboard/ai/$threadId`, and
 * `/dashboard/ai` redirects to a freshly minted one — see `index.tsx`.
 *
 * Splitting it this way is what gives every conversation a URL, which is the
 * whole of "keep the history": a chat you can link to, reload, and come back
 * to. It follows the shape `discover.tsx` already uses for the same reason.
 */
export const Route = createFileRoute("/_protected/dashboard/ai")({
  component: () => <Outlet />,
})
