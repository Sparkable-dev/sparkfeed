import { createFileRoute } from "@tanstack/react-router"
import { handlePlatformRequest } from "@/server/platform/handler"

export const Route = createFileRoute("/api/internal/platform/$")({
  server: {
    handlers: {
      GET: ({ request }) => handlePlatformRequest(request),
      POST: ({ request }) => handlePlatformRequest(request),
    },
  },
})
