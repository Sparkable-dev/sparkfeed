import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/login")({
  beforeLoad: ({ location }) => {
    throw redirect({
      href: `/sign-in${location.searchStr}${location.hash ? `#${location.hash}` : ""}`,
      replace: true,
    })
  },
})
