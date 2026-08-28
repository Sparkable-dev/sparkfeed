import { Outlet, createFileRoute } from "@tanstack/react-router"

/**
 * Layout-only parent for /discover and /discover/$categorySlug.
 *
 * The catalogue page moved to discover/index.tsx when the per-category route
 * arrived: a file with siblings under it becomes their layout, so leaving the
 * page here would have rendered the whole catalogue wrapped around every
 * category page, shell and all.
 */
export const Route = createFileRoute("/_protected/discover")({
  component: () => <Outlet />,
})
