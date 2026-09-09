import { and, countDistinct, eq, gte, sql } from "drizzle-orm"
import { articleInWorkspace } from "./tenancy"
import { db } from "@/db/index"
import { articles, feeds } from "@/db/schema"

export async function readNavigationCounts(workspaceId: string | null) {
  const scope = articleInWorkspace(workspaceId)
  const since = new Date(Date.now() - 86_400_000).toISOString()
  const [perFeed, perFolder, totals, today] = await Promise.all([
    db
      .select({ id: articles.feedId, count: countDistinct(articles.link) })
      .from(articles)
      .where(scope)
      .groupBy(articles.feedId),
    db
      .select({ id: feeds.folderId, count: countDistinct(articles.link) })
      .from(articles)
      .innerJoin(feeds, eq(feeds.id, articles.feedId))
      .where(scope)
      .groupBy(feeds.folderId),
    db
      .select({ count: countDistinct(articles.link) })
      .from(articles)
      .where(scope),
    db
      .select({ count: countDistinct(articles.link) })
      .from(articles)
      .where(
        and(
          scope,
          gte(
            sql`coalesce(${articles.publishedAt}, ${articles.createdAt}, '')`,
            since
          )
        )
      ),
  ])
  return {
    feeds: Object.fromEntries(
      perFeed.filter((row) => row.id).map((row) => [row.id!, Number(row.count)])
    ),
    folders: Object.fromEntries(
      perFolder
        .filter((row) => row.id)
        .map((row) => [row.id!, Number(row.count)])
    ),
    total: Number(totals[0]?.count ?? 0),
    today: Number(today[0]?.count ?? 0),
  }
}
