import { eq, isNull, sql } from "drizzle-orm"
import type { SQL } from "drizzle-orm"
import {
  articles,
  feeds,
  folders,
  scrapedArticles,
  scrapedFeeds,
} from "@/db/schema"

/**
 * SQL predicates that scope a query to one workspace.
 *
 * These exist so tenancy is one import rather than a filter each caller
 * remembers to write. Every one of them treats a null workspace as
 * `workspace_id IS NULL` rather than as "no filter" — the difference between
 * scoping a query and disabling it.
 */

export function folderInWorkspace(workspaceId: string | null): SQL {
  return workspaceId
    ? eq(folders.workspaceId, workspaceId)
    : isNull(folders.workspaceId)
}

export function feedInWorkspace(workspaceId: string | null): SQL {
  return workspaceId
    ? eq(feeds.workspaceId, workspaceId)
    : isNull(feeds.workspaceId)
}

export function scrapedFeedInWorkspace(workspaceId: string | null): SQL {
  return workspaceId
    ? eq(scrapedFeeds.workspaceId, workspaceId)
    : isNull(scrapedFeeds.workspaceId)
}

/**
 * Unlike `articles`, `scraped_articles` carries `workspace_id` directly, so no
 * EXISTS subquery is needed — the scraper writes the anchor at ingest time.
 */
export function scrapedArticleInWorkspace(workspaceId: string | null): SQL {
  return workspaceId
    ? eq(scrapedArticles.workspaceId, workspaceId)
    : isNull(scrapedArticles.workspaceId)
}

/**
 * Scopes an `articles` query to a workspace.
 *
 * `articles` has no `workspace_id` column: ownership is only reachable through
 * `articles.feed_id -> feeds.workspace_id`. An EXISTS subquery is used rather
 * than a join so this composes into an UPDATE/DELETE `WHERE`, where a join is
 * not available.
 *
 * Without this, every article mutation is an IDOR: the handlers took an id and
 * acted on it, which was safe only because the sole caller was a UI that never
 * showed you someone else's ids. An API key removes that assumption.
 */
export function articleInWorkspace(workspaceId: string | null): SQL {
  const ownerMatch = workspaceId
    ? sql`${feeds.workspaceId} = ${workspaceId}`
    : sql`${feeds.workspaceId} is null`

  return sql`exists (
    select 1 from ${feeds}
    where ${feeds.id} = ${articles.feedId}
      and ${ownerMatch}
  )`
}
