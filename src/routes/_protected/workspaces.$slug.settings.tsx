import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/_protected/workspaces/$slug/settings")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/settings/workspaces/$slug",
      params: { slug: params.slug },
      search: { section: params.slug === "personal" ? "billing" : "general" },
    } as never)
  },
})
