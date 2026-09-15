import { randomUUID } from "node:crypto"
import { createFileRoute } from "@tanstack/react-router"
import { and, eq } from "drizzle-orm"
import { workspaceIsSuspended } from "@/server/entitlements/suspension"
import { assertWorkspaceWritable } from "@/server/entitlements/browser-write"
import { db } from "@/db/index"
import { feeds, folders } from "@/db/schema"
import { resolveWorkspaceContextFromHeaders } from "@/server/services/context"
import {
  resolveInheritedShare,
  verifySharePassword,
} from "@/server/services/shares"

export const Route = createFileRoute("/api/folders/add-to-workspace")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          // 1. Require authentication
          const caller = await resolveWorkspaceContextFromHeaders(request.headers)
          if (!caller.userId || !caller.workspaceId) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            })
          }

          try { await assertWorkspaceWritable(caller) }
          catch { return Response.json({error:"This workspace is not writable."},{status:403}) }

          // 2. Get user's active workspaceId
          const userWorkspaceId = caller.workspaceId

          // 3. Parse request body
          const body = await request.json()
          const { sharedFolderId, customFolderName } = body as {
            sharedFolderId: string
            customFolderName?: string
          }

          if (!sharedFolderId) {
            return new Response(
              JSON.stringify({ error: "sharedFolderId is required" }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              }
            )
          }

          // 4. Fetch the shared folder
          const sharedFolderResult = await db
            .select({
              id: folders.id,
              name: folders.name,
              workspaceId: folders.workspaceId,
              parentId: folders.parentId,
            })
            .from(folders)
            .where(eq(folders.id, sharedFolderId))
            .limit(1)

          if (sharedFolderResult.length === 0) {
            return new Response(
              JSON.stringify({ error: "Folder not found" }),
              {
                status: 404,
                headers: { "Content-Type": "application/json" },
              }
            )
          }

          const sharedFolder = sharedFolderResult[0]
          if (await workspaceIsSuspended(sharedFolder.workspaceId))
            return Response.json({ error: "Folder not available" }, { status: 404 })

          // 4b. Confirm the caller is actually allowed to copy this folder.
          //
          // This handler used to take an id and clone whatever it pointed at,
          // so any signed-in user could copy any folder in the database — a
          // worse version of the read IDOR, because it writes. Owners are
          // allowed through (copying your own folder is harmless); everyone
          // else needs a live share, and its password if it has one.
          if (sharedFolder.workspaceId !== userWorkspaceId) {
            const share = await resolveInheritedShare(
              sharedFolder.id,
              "folder",
              { name: sharedFolder.name, parentId: sharedFolder.parentId },
            )

            if (!share) {
              return new Response(
                JSON.stringify({ error: "not_shared", message: "This folder is no longer shared" }),
                { status: 403, headers: { "Content-Type": "application/json" } }
              )
            }

            if (share.password) {
              const supplied = request.headers.get("x-share-password")
              if (
                !supplied ||
                !(await verifySharePassword(supplied, share.password))
              ) {
                return new Response(
                  JSON.stringify({ error: "password_required" }),
                  { status: 401, headers: { "Content-Type": "application/json" } }
                )
              }
            }
          }

          // 5. Check if user already has a folder with this name
          const existingFolder = await db
            .select({ id: folders.id })
            .from(folders)
            .where(
              and(
                eq(folders.workspaceId, userWorkspaceId),
                eq(folders.name, sharedFolder.name)
              )
            )
            .limit(1)

          if (existingFolder.length > 0 && !customFolderName) {
            return new Response(
              JSON.stringify({
                error: "already_exists",
                message: "You already have a folder with this name",
                suggestedName: sharedFolder.name + " (Shared)",
              }),
              {
                status: 409,
                headers: { "Content-Type": "application/json" },
              }
            )
          }

          if (customFolderName) {
            const customExists = await db
              .select({ id: folders.id })
              .from(folders)
              .where(
                and(
                  eq(folders.workspaceId, userWorkspaceId),
                  eq(folders.name, customFolderName)
                )
              )
              .limit(1)

            if (customExists.length > 0) {
              return new Response(
                JSON.stringify({
                  error: "already_exists",
                  message: "This name is also taken. Please choose a different name.",
                  suggestedName: customFolderName + " (2)",
                }),
                {
                  status: 409,
                  headers: { "Content-Type": "application/json" },
                }
              )
            }
          }

          // 6. Create new folder in user's workspace
          const newFolderId = randomUUID()
          const newFolderName = customFolderName || sharedFolder.name

          await db.insert(folders).values({
            id: newFolderId,
            name: newFolderName,
            workspaceId: userWorkspaceId,
            createdAt: new Date().toISOString(),
          })

          // 7. Fetch all feeds from shared folder
          const sharedFeeds = await db
            .select({ id: feeds.id, name: feeds.name, url: feeds.url })
            .from(feeds)
            .where(eq(feeds.folderId, sharedFolderId))

          // 8. Insert the feeds into the user's workspace, in one round trip
          if (sharedFeeds.length > 0) {
            await db.insert(feeds).values(
              sharedFeeds.map((feed) => ({
                id: randomUUID(),
                name: feed.name,
                url: feed.url,
                folderId: newFolderId,
                workspaceId: userWorkspaceId,
              }))
            )
          }

          // 9. Return success
          return new Response(
            JSON.stringify({
              success: true,
              folderId: newFolderId,
              folderName: newFolderName,
              feedCount: sharedFeeds.length,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          )
        } catch (err) {
          console.error("Add to workspace error:", err)
          return new Response(
            JSON.stringify({ error: "Internal server error" }),
            {
              status: 500,
              headers: { "Content-Type": "application/json" },
            }
          )
        }
      },
    },
  },
})
