import { createFileRoute } from "@tanstack/react-router"
import { generateXMLFeed } from "@/server/utils/generateXML"

export const Route = createFileRoute("/api/rss/$slug")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const { slug } = params
        const url = new URL(request.url)

        try {
          const xml = await generateXMLFeed(slug, url.origin)

          if (!xml) {
            return new Response(JSON.stringify({ error: "Feed not found" }), {
              status: 404,
              headers: { "Content-Type": "application/json" },
            })
          }

          return new Response(xml, {
            status: 200,
            headers: {
              "Content-Type": "application/rss+xml; charset=utf-8",
              "Cache-Control": "public, max-age=3600"
            },
          })
        } catch (err) {
          console.error("RSS API Error:", err)
          return new Response(JSON.stringify({ error: "Internal server error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          })
        }
      },
    },
  },
})
