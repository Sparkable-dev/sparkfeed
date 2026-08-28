/**
 * Tool result shapes, for the client renderers.
 *
 * **This module must never gain a runtime import.** Every import below is
 * `import type`, which TypeScript erases entirely — the emitted JavaScript is
 * empty. That is what lets a browser component be strongly typed against a
 * server function's return value without dragging Drizzle, the DB handle, or
 * the whole services layer into the client bundle.
 *
 * If someone adds a value import here, TanStack's import protection will fail
 * the build (see the note in `src/server/services/context.ts`). That is the
 * correct outcome, but it tends to surface as a confusing unrelated-looking
 * build error, so: types only.
 *
 * Shapes are derived from the service functions rather than restated, so a
 * change to a service is a compile error in the renderer instead of a silent
 * mismatch at runtime.
 */

import type {
  getWorkspaceInfo,
  listFeeds,
  listFolders,
} from "../services/workspace"
import type { getArticle, searchArticles } from "../services/articles"
import type { findFeeds, verifyFeed } from "../services/discovery"
import type { readUrl } from "../services/reader"
import type { buildChart } from "../services/charts"
import type { addFeed, createFolder, moveFeed } from "../services/sources-write"
import type { setArticleFlag } from "../services/curation"

type Result<T extends (...args: Array<never>) => unknown> = Awaited<
  ReturnType<T>
>

export type WorkspaceInfoResult = Result<typeof getWorkspaceInfo>
export type ListFoldersResult = Result<typeof listFolders>
export type ListFeedsResult = Result<typeof listFeeds>
export type SearchArticlesResult = Result<typeof searchArticles>
export type GetArticleResult = Result<typeof getArticle>
export type FindFeedsResult = Result<typeof findFeeds>
export type VerifyFeedResult = Result<typeof verifyFeed>
export type ReadUrlResult = Result<typeof readUrl>
export type ChartResult = Result<typeof buildChart>
export type AddFeedResult = Result<typeof addFeed>
export type CreateFolderResult = Result<typeof createFolder>
export type MoveFeedResult = Result<typeof moveFeed>
export type SetArticleFlagResult = Result<typeof setArticleFlag>

/** One row of `list_feeds`, which the feed table renders. */
export type FeedRow = ListFeedsResult["feeds"][number]
/** One row of `list_folders`. */
export type FolderRow = ListFoldersResult["folders"][number]
/** One article summary from `search_articles`. */
export type ArticleRow = SearchArticlesResult["articles"][number]
/** One candidate from `find_feeds`. */
export type FeedCandidateRow = FindFeedsResult["feeds"][number]

/**
 * Re-exported so a renderer can import the failure shape alongside the success
 * shapes. The runtime predicate deliberately lives in `@/lib/tool-result`, not
 * here — see that file.
 */
export type { ToolErrorResult } from "@/lib/tool-result"
