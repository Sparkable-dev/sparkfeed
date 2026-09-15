import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/signup")({
  beforeLoad: ({ location }) => {
    throw redirect({
      href: `/sign-up${location.searchStr}${location.hash ? `#${location.hash}` : ""}`,
      replace: true,
    })
  },
})
