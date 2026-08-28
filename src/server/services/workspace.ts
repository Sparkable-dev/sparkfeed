import { and, eq } from "drizzle-orm"
import { decodeId, encodeId } from "./ids"
import {
  feedInWorkspace,
  folderInWorkspace,
} from "./tenancy"
import { DEFAULT_LIMIT, MAX_LIMIT } from "./pagination"
import { MAX_RESPONSE_BYTES } from "./budget"
import { FEED_ORDER, FOLDER_ORDER } from "./ordering"
import {
  articleCountsByFolder,
  articleStatsByFeed,
  unhealthyFeeds,
  workspaceCounts,
} from "./stats"
import type { ApiPrincipal } from "../api/principal"
import { feeds, folders } from "@/db/schema"
import { db } from "@/db/index"

/**
 * The orientation call.
 *
 * Exists so an agent can open a session by asking what it is allowed to do,
 * rather than discovering the boundaries by collecting 403s.
 *
 * It returns more than counts on purpose. "How many feeds do we have?" is
 * almost never a request for one integer — the useful answer says how much is
 * unread, which folders are busiest, and which sources are broken. Returning
 * all of that in one call is also what stops the model making four more.
 */
export async function getWorkspaceInfo(principal: ApiPrincipal) {
  const [counts, byFolder, folderRows, unhealthy, byFeed] = await Promise.all([
    workspaceCounts(principal),
    articleCountsByFolder(principal),
    db
      .select({ id: folders.id, name: folders.name })
      .from(folders)
      .where(folderInWorkspace(principal.workspaceId))
      .orderBy(...FOLDER_ORDER),
    unhealthyFeeds(principal),
    articleStatsByFeed(principal),
  ])

  const feedNames = await feedNameMap(principal)

  const busiestFolders = folderRows
    .map((f) => ({
      id: encodeId("folder", f.id),
      name: f.name,
      unread: byFolder.get(f.id)?.unread_count ?? 0,
      articles: byFolder.get(f.id)?.article_count ?? 0,
    }))
    .sort((a, b) => b.unread - a.unread)
    .slice(0, 5)

  const busiestFeeds = [...byFeed.values()]
    .sort((a, b) => b.posts_30d - a.posts_30d)
    .slice(0, 5)
    .map((s) => ({
      id: encodeId("feed", s.feedId),
      name: feedNames.get(s.feedId) ?? "Unknown feed",
      posts_30d: s.posts_30d,
      unread: s.unread_count,
    }))

  return {
    workspace: {
      id: encodeId("workspace", principal.workspaceId ?? "none"),
      demo: principal.demo,
    },
    plan: principal.plan,
    counts: {
      folders: counts.folders,
      // Kept as the rss + scraped total so it agrees with `list_feeds`, which
      // now returns both kinds. The split is exposed alongside it.
      feeds: counts.feeds,
      feeds_rss: counts.feeds_rss,
      feeds_scraped: counts.feeds_scraped,
      articles_total: counts.articles_total,
      articles_30d: counts.articles_30d,
      unread: counts.unread,
      favorites: counts.favorites,
    },
    busiest_folders: busiestFolders,
    busiest_feeds: busiestFeeds,
    needs_attention: unhealthy.map((f) => ({
      id: encodeId("feed", f.id),
      name: f.name,
      last_error: f.last_error,
      never_fetched: f.never_fetched,
    })),
    capabilities: principal.scopes,
    limits: {
      search_limit_default: DEFAULT_LIMIT,
      search_limit_max: MAX_LIMIT,
      response_bytes_max: MAX_RESPONSE_BYTES,
    },
  }
}

async function feedNameMap(
  principal: ApiPrincipal
): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: feeds.id, name: feeds.name })
    .from(feeds)
    .where(feedInWorkspace(principal.workspaceId))
  return new Map(rows.map((f) => [f.id, f.name]))
}

/**
 * The folder tree.
 *
 * Unpaginated on purpose: nobody has hundreds of folders, and the point of this
 * call is one cheap round trip that orients the agent. It never returns article
 * bodies, and it never creates a default folder the way `getAllData` does — a
 * discovery tool must not write.
 *
 * `parent_id` is included because `folders.parentId` is real and nesting is
 * user-visible in the sidebar; without it the agent describes a flat list and
 * contradicts what the user is looking at.
 */
export async function listFolders(principal: ApiPrincipal) {
  const { workspaceId } = principal

  const [rows, feedRows, byFolder] = await Promise.all([
    db
      .select({
        id: folders.id,
        name: folders.name,
        parentId: folders.parentId,
      })
      .from(folders)
      .where(folderInWorkspace(workspaceId))
      .orderBy(...FOLDER_ORDER),
    db
      .select({ id: feeds.id, folderId: feeds.folderId })
      .from(feeds)
      .where(feedInWorkspace(workspaceId)),
    articleCountsByFolder(principal),
  ])

  const feedsByFolder = new Map<string | null, number>()
  for (const f of feedRows) {
    feedsByFolder.set(f.folderId, (feedsByFolder.get(f.folderId) ?? 0) + 1)
  }

  return {
    folders: rows.map((f) => ({
      id: encodeId("folder", f.id),
      name: f.name,
      parent_id: f.parentId ? encodeId("folder", f.parentId) : null,
      feed_count: feedsByFolder.get(f.id) ?? 0,
      unread_count: byFolder.get(f.id)?.unread_count ?? 0,
    })),
  }
}

/**
 * Sources in the workspace, in the order the user arranged them.
 *
 * The order is load-bearing rather than cosmetic: there is a `limit` and no
 * cursor, so it decides *which* sources a caller sees, not just their sequence.
 *
 * Two things this used to get wrong. It compared the raw `folder_id` argument
 * against the stored id, so a prefixed `fld_…` — the only form any caller ever
 * has — matched nothing and the filter silently returned an empty list. And it
 * omitted scraped sources entirely while `get_workspace_info` counted them, so
 * "how many feeds" and "list my feeds" disagreed. Both are fixed here.
 */
export async function listFeeds(
  principal: ApiPrincipal,
  args: { folderId?: string; limit?: number } = {}
) {
  const { workspaceId } = principal
  const limit = Math.min(args.limit ?? 100, 200)
  const rawFolderId = args.folderId
    ? decodeId("folder", args.folderId)
    : undefined

  const [rows, byFeed] = await Promise.all([
    db
      .select({
        id: feeds.id,
        name: feeds.name,
        url: feeds.url,
        folderId: feeds.folderId,
        kind: feeds.kind,
        lastFetchedAt: feeds.lastFetchedAt,
        lastError: feeds.lastError,
      })
      .from(feeds)
      .where(
        rawFolderId
          ? and(feedInWorkspace(workspaceId), eq(feeds.folderId, rawFolderId))
          : feedInWorkspace(workspaceId)
      )
      .orderBy(...FEED_ORDER)
      .limit(limit),
    articleStatsByFeed(principal),
  ])

  /*
    One list. Watched pages used to be a second query against `scraped_feeds`
    with every article number forced to null, because that table had no read
    state to report. They are `feeds` rows now, so they carry the same counts
    as anything else and `kind` is read off the column.
  */
  const list = rows.map((f) => {
    const stats = byFeed.get(f.id)
    return {
      id: encodeId("feed", f.id),
      name: f.name,
      url: f.url,
      folder_id: f.folderId ? encodeId("folder", f.folderId) : null,
      kind: f.kind === "page" ? ("scraped" as const) : ("rss" as const),
      article_count: stats?.article_count ?? 0,
      unread_count: stats?.unread_count ?? 0,
      posts_30d: stats?.posts_30d ?? 0,
      last_published_at: stats?.last_published_at ?? null,
      last_fetched_at: f.lastFetchedAt,
      last_error: f.lastError,
    }
  })

  return { feeds: list }
}
