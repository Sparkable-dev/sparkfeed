import { createFileRoute } from "@tanstack/react-router"
import { generateXMLFeed } from "@/server/utils/generateXML"

export const Route = createFileRoute("/$folderSlug/$feedSlug/feed")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const { folderSlug, feedSlug } = params
        const url = new URL(request.url)

        try {
          const xml = await generateXMLFeed(folderSlug, url.origin, feedSlug)

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
              "Cache-Control": "no-store"
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
