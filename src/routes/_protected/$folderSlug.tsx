import { Outlet, createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_protected/$folderSlug")({
  component: () => <Outlet />,
})
