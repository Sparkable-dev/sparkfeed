import { createFileRoute } from "@tanstack/react-router"
import { buildSharePath } from "@/lib/share-url"
import {
  readShareSettings,
  writeShareSettings,
} from "@/server/services/share-settings"

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

export const Route = createFileRoute("/api/feeds/share")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const feedId = new URL(request.url).searchParams.get("feedId")
          if (!feedId) return json({ error: "Missing feedId" }, 400)

          const result = await readShareSettings("feed", feedId, request.headers)
          if (!result.ok) return json({ error: result.error }, result.status)

          return json({
            isShared: result.isShared,
            hasPassword: result.hasPassword,
          })
        } catch (err) {
          console.error("Share Feed API Error:", err)
          return json({ error: "Internal server error" }, 500)
        }
      },

      POST: async ({ request }) => {
        try {
          const body = await request.json()
          const { feedId, feedName, isShared } = body

          if (!feedId || !feedName || typeof isShared !== "boolean") {
            return json({ error: "Invalid request body" }, 400)
          }

          // `in` rather than reading the value: absent means "leave the existing
          // password alone", which is different from an explicit null.
          const result = await writeShareSettings(
            "feed",
            feedId,
            {
              isShared,
              ...("password" in body ? { password: body.password } : {}),
            },
            request.headers,
          )
          if (!result.ok) return json({ error: result.error }, result.status)

          return json({
            success: true,
            isShared: result.isShared,
            hasPassword: result.hasPassword,
            shareUrl: buildSharePath(feedName, feedId),
          })
        } catch (err) {
          console.error("Share Feed API Error:", err)
          return json({ error: "Internal server error" }, 500)
        }
      },
    },
  },
})
