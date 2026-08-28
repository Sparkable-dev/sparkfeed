import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: () =>
        Response.json({
          status: "ok",
          version: process.env.npm_package_version ?? "0.1.0-beta.1",
        }),
    },
  },
})
