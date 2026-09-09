import { createServerFn } from "@tanstack/react-start"
import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm"
import { z } from "zod"
import { resolveWorkspaceContext } from "./services/context"
import { articleInWorkspace } from "./services/tenancy"
import {
  personalFavoriteCondition,
  supportsWorkspaceFavorites,
  writeFavorites,
} from "./services/favorites"
import { decodeCursor, keysetWhere, takePage } from "./services/pagination"
import { ARTICLE_LIST_COLUMNS } from "./services/projections"
import { workspaceWriteMiddleware } from "./entitlements/browser-write"
import { db } from "@/db/index"
import { articles, feeds } from "@/db/schema"

const scopeSchema = z.object({
  workspaceId: z.string().min(1),
  userId: z.string().min(1),
})
export const articlePageSchema = scopeSchema.extend({
  feedId: z.string().optional(),
  folderId: z.string().optional(),
  favorites: z.enum(["personal", "workspace"]).optional(),
  days: z.number().int().min(0).max(365).default(15),
  query: z.string().max(200).default(""),
  cursor: z.string().max(1000).optional(),
  demoFavoriteIds: z.array(z.string()).max(500).optional(),
})
export type ArticlePageInput = z.input<typeof articlePageSchema>

export async function assertReaderScope(scope: z.infer<typeof scopeSchema>) {
  const context = await resolveWorkspaceContext()
  if (
    !context.workspaceId ||
    context.workspaceId !== scope.workspaceId ||
    context.userId !== scope.userId
  )
    throw new Error("Workspace changed. Reload this page.")
  return context
}

export const getArticlePage = createServerFn({ method: "GET" })
  .validator(articlePageSchema)
  .handler(async ({ data }) => {
    const context = await assertReaderScope(data)
    if (
      data.favorites === "workspace" &&
      !(await supportsWorkspaceFavorites(context))
    )
      throw new Error("Workspace favorites are locked for this plan.")
    const sort = sql<string>`coalesce(${articles.publishedAt}, ${articles.createdAt}, '')`
    const conditions = [articleInWorkspace(data.workspaceId)]
    if (data.feedId) conditions.push(eq(articles.feedId, data.feedId))
    if (data.folderId) conditions.push(eq(feeds.folderId, data.folderId))
    // Saved articles never expire out of this view because of their publication date.
    if (data.favorites === "personal")
      conditions.push(
        context.demo
          ? data.demoFavoriteIds?.length
            ? inArray(articles.id, data.demoFavoriteIds)
            : sql`false`
          : personalFavoriteCondition(data.userId)
      )
    else if (data.favorites === "workspace")
      conditions.push(eq(articles.isFavorite, true))
    else if (data.days)
      conditions.push(
        gte(sort, new Date(Date.now() - data.days * 86_400_000).toISOString())
      )
    const query = data.query.trim().toLowerCase()
    if (query) {
      const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`
      conditions.push(
        or(
          sql`lower(${articles.title}) like ${pattern} escape '\\'`,
          sql`lower(${feeds.name}) like ${pattern} escape '\\'`,
          sql`lower(${articles.link}) like ${pattern} escape '\\'`
        )!
      )
    }
    if (data.cursor)
      conditions.push(keysetWhere(sort, articles.id, decodeCursor(data.cursor)))
    const rows = await db
      .select({ ...ARTICLE_LIST_COLUMNS, feedName: feeds.name })
      .from(articles)
      .innerJoin(feeds, eq(feeds.id, articles.feedId))
      .where(and(...conditions))
      .orderBy(desc(sort), desc(articles.id))
      .limit(41)
    return takePage(rows, 40, (row) => ({
      v: row.publishedAt ?? row.createdAt ?? "",
      id: row.id,
    }))
  })

export const setFavorites = createServerFn({ method: "POST" })
  .middleware([workspaceWriteMiddleware])
  .validator(
    scopeSchema.extend({
      ids: z.array(z.string().min(1)).min(1).max(500),
      scope: z.enum(["personal", "workspace"]),
      state: z.boolean(),
    })
  )
  .handler(async ({ data }) =>
    writeFavorites(
      await assertReaderScope(data),
      data.ids,
      data.scope,
      data.state
    )
  )
