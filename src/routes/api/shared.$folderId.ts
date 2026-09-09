import { createFileRoute } from "@tanstack/react-router"
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm"
import type {ShareKind} from "@/server/services/shares";
import { db } from "@/db/index"
import { articles, feeds, folders } from "@/db/schema"
import { resolveWorkspaceContextFromHeaders } from "@/server/services/context"
import { workspaceIsSuspended } from "@/server/entitlements/suspension"
import {

  resolveInheritedShare,
  upgradeLegacySharePassword,
  verifySharePassword
} from "@/server/services/shares"
import {
  ARTICLE_LIST_COLUMNS,
  ARTICLE_PUBLIC_COLUMNS,
} from "@/server/services/projections"

const ARTICLE_LIMIT = 200

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

/**
 * Public read endpoint for a shared folder or feed.
 *
 * One `$folderId` param, polymorphic over both — the id is looked up in
 * `folders` first and falls back to `feeds`. The response carries `kind` so the
 * client does not have to guess.
 *
 * `viewer` replaces the old `status: "authenticated"` branch. That branch
 * returned the full payload to *anyone* with a session, before the share check
 * ran and with no comparison between the entity's workspace and the caller's,
 * so any signed-in user could read any folder in the database by id.
 * Authentication now decides presentation; the share state decides access.
 */
export const Route = createFileRoute("/api/shared/$folderId")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        try {
          const { folderId } = params

          // ── Resolve the entity ──────────────────────────────
          const folderResult = await db
            .select({
              id: folders.id,
              name: folders.name,
              workspaceId: folders.workspaceId,
              parentId: folders.parentId,
            })
            .from(folders)
            .where(eq(folders.id, folderId))
            .limit(1)

          let kind: ShareKind = "folder"
          let entity: {
            id: string
            name: string
            workspaceId: string | null
            parentId: string | null
          }

          if (folderResult.length === 0) {
            const feedResult = await db
              .select({
                id: feeds.id,
                name: feeds.name,
                workspaceId: feeds.workspaceId,
                folderId: feeds.folderId,
              })
              .from(feeds)
              .where(eq(feeds.id, folderId))
              .limit(1)

            if (feedResult.length === 0) {
              return json({ status: "not_found" }, 404)
            }

            kind = "feed"
            const feed = feedResult[0]
            entity = {
              id: feed.id,
              name: feed.name,
              workspaceId: feed.workspaceId,
              // A feed's "parent" for inheritance purposes is its folder.
              parentId: feed.folderId,
            }
          } else {
            entity = folderResult[0]
          }

          if (await workspaceIsSuspended(entity.workspaceId))
            return json({ status: "not_found" }, 404)

          // ── Payload builders ────────────────────────────────
          const feedIdsForEntity = async (): Promise<Array<string>> => {
            if (kind === "feed") return [entity.id]
            const rows = await db
              .select({ id: feeds.id })
              .from(feeds)
              .where(eq(feeds.folderId, entity.id))
            return rows.map((f) => f.id)
          }

          // Projection, not `db.select()`. Without one Drizzle emits every
          // column in the TS schema, so adding a column breaks every read
          // against a database that has not been migrated yet — which is how
          // this endpoint started 500ing when `articles.content` landed, while
          // the logged-in app kept working because its reads are projected.
          const fetchEntityArticles = async (full: boolean) => {
            const feedIds = await feedIdsForEntity()
            if (feedIds.length === 0) return []
            return await db
              .select(full ? ARTICLE_LIST_COLUMNS : ARTICLE_PUBLIC_COLUMNS)
              .from(articles)
              .where(inArray(articles.feedId, feedIds))
              .orderBy(desc(articles.publishedAt))
              .limit(ARTICLE_LIMIT)
          }

          const fetchEntityFeeds = async () =>
            await db
              .select({ id: feeds.id, name: feeds.name, url: feeds.url })
              .from(feeds)
              .where(
                kind === "feed"
                  ? eq(feeds.id, entity.id)
                  : eq(feeds.folderId, entity.id),
              )

          const fetchEntitySubfolders = async () => {
            if (kind === "feed") return []

            const subs = await db
              .select({ id: folders.id, name: folders.name })
              .from(folders)
              .where(
                entity.workspaceId
                  ? and(
                      eq(folders.parentId, entity.id),
                      eq(folders.workspaceId, entity.workspaceId),
                    )
                  : and(
                      eq(folders.parentId, entity.id),
                      isNull(folders.workspaceId),
                    ),
              )

            const result = []
            for (const sub of subs) {
              const subFeeds = await db
                .select({ id: feeds.id })
                .from(feeds)
                .where(eq(feeds.folderId, sub.id))
              const feedIds = subFeeds.map((f) => f.id)
              let articleCount = 0
              if (feedIds.length > 0) {
                // COUNT(*), not "fetch every id and take .length".
                const [row] = await db
                  .select({ value: count() })
                  .from(articles)
                  .where(inArray(articles.feedId, feedIds))
                articleCount = Number(row?.value ?? 0)
              }
              result.push({ id: sub.id, name: sub.name, articleCount })
            }
            return result
          }

          const buildPayload = async (viewer: {
            authenticated: boolean
            isOwner: boolean
            canAdd: boolean
          }, breadcrumbs: Array<{ id: string; name: string }>) => {
            const [fetchedArticles, fetchedFeeds, subfolders] = await Promise.all([
              fetchEntityArticles(viewer.isOwner),
              fetchEntityFeeds(),
              fetchEntitySubfolders(),
            ])
            return json({
              status: "public",
              kind,
              folder: entity,
              articles: fetchedArticles,
              feeds: fetchedFeeds,
              subfolders,
              breadcrumbs,
              viewer,
            })
          }

          // ── Who is asking ───────────────────────────────────
          // Must not call `auth.api.getSession` directly: in demo mode the
          // better-auth tables are never created, so touching them throws and
          // the whole share route 500s. resolveWorkspaceContextFromHeaders puts
          // the demo branch first.
          const rawCaller = await resolveWorkspaceContextFromHeaders(request.headers, { allowSuspended: true })

          // A demo deployment has no accounts — `resolveWorkspaceContext`
          // hands every request the same synthetic user so the app has a
          // workspace to read. Honouring that here would make every visitor to
          // a share link look like its owner, so the demo could never show the
          // one thing a share link is for. Treat demo callers as anonymous:
          // they still see anything genuinely shared, as a guest.
          const caller = rawCaller.demo
            ? { workspaceId: null, userId: null, demo: true }
            : rawCaller

          const share = await resolveInheritedShare(entity.id, kind, {
            name: entity.name,
            parentId: entity.parentId,
          })
          const breadcrumbs = share?.breadcrumbs ?? [
            { id: entity.id, name: entity.name },
          ]

          // ── Owners see their own entity, shared or not ──────
          const isOwner =
            !!caller.workspaceId && entity.workspaceId === caller.workspaceId

          if (isOwner) {
            return await buildPayload(
              { authenticated: true, isOwner: true, canAdd: false },
              breadcrumbs,
            )
          }

          // ── Everyone else goes through the share gate ───────
          if (!share) {
            return json({ status: "private", hasPassword: false })
          }

          const viewer = {
            authenticated: !!caller.userId,
            isOwner: false,
            canAdd: !!caller.userId,
          }

          if (!share.password) {
            return await buildPayload(viewer, breadcrumbs)
          }

          // The password belongs to the nearest shared ancestor, which may not
          // be the entity the visitor asked for. They only ever see one prompt.
          const supplied = request.headers.get("x-share-password")
          if (!supplied) {
            return json({ status: "private", hasPassword: true })
          }
          if (!(await verifySharePassword(supplied, share.password))) {
            return json({ status: "wrong_password" }, 401)
          }

          // Retire the plaintext now that we know the correct value, so shares
          // created before hashing landed do not stay plaintext forever.
          await upgradeLegacySharePassword(share, supplied)

          return await buildPayload(viewer, breadcrumbs)
        } catch (err) {
          console.error("Shared Folder API Error:", err)
          // `status` matters: the client switches on it, and a body without one
          // falls through every branch to a bare "something went wrong".
          return json(
            { status: "error", error: "Internal server error" },
            500,
          )
        }
      },
    },
  },
})
