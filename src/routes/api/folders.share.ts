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

export const Route = createFileRoute("/api/folders/share")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const folderId = new URL(request.url).searchParams.get("folderId")
          if (!folderId) return json({ error: "Missing folderId" }, 400)

          const result = await readShareSettings(
            "folder",
            folderId,
            request.headers,
          )
          if (!result.ok) return json({ error: result.error }, result.status)

          return json({
            isShared: result.isShared,
            hasPassword: result.hasPassword,
          })
        } catch (err) {
          console.error("Share Folder API Error:", err)
          return json({ error: "Internal server error" }, 500)
        }
      },

      POST: async ({ request }) => {
        try {
          const body = await request.json()
          const { folderId, folderName, isShared } = body

          if (!folderId || !folderName || typeof isShared !== "boolean") {
            return json({ error: "Invalid request body" }, 400)
          }

          // `in` rather than reading the value: absent means "leave the existing
          // password alone", which is different from an explicit null.
          const result = await writeShareSettings(
            "folder",
            folderId,
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
            shareUrl: buildSharePath(folderName, folderId),
          })
        } catch (err) {
          console.error("Share Folder API Error:", err)
          return json({ error: "Internal server error" }, 500)
        }
      },
    },
  },
})
