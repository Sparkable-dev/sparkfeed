import { createFileRoute } from "@tanstack/react-router"
import { getAllData } from "@/server/rss"
import { auth } from "@/lib/auth"

export const Route = createFileRoute("/api/workspace-data")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const session = await auth.api.getSession({ headers: request.headers })
          if (!session?.user) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            })
          }

          // getAllData reads session from request headers via getRequestHeaders()
          // We call it as a plain async function by invoking the underlying fetch
          const data = await getAllData()

          return new Response(JSON.stringify(data), {
            status: 200,
            headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
          })
        } catch (err) {
          console.error("Workspace data API error:", err)
          return new Response(JSON.stringify({ error: "Internal server error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          })
        }
      },
    },
  },
})
