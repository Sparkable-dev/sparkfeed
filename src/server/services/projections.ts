import { articles } from "@/db/schema"

/**
 * Explicit projection for article list reads.
 *
 * Deliberately not `db.select()`: with no projection Drizzle emits every column
 * in the TypeScript schema, so adding a column to schema.pg.ts breaks every
 * read against a database that has not been migrated yet. That is exactly how
 * `articles.content` took the whole app down. `content` is excluded here anyway
 * because list views never render it; getArticlePreview fetches it on demand.
 *
 * Lives in its own module rather than in `rss.ts` so the public share route can
 * import it. `rss.ts` handler bodies are replaced by RPC stubs in the client
 * build; a plain projection module has no such hazard.
 */
export const ARTICLE_LIST_COLUMNS = {
  id: articles.id,
  feedId: articles.feedId,
  title: articles.title,
  description: articles.description,
  link: articles.link,
  image: articles.image,
  publishedAt: articles.publishedAt,
  isUsed: articles.isUsed,
  visitCount: articles.visitCount,
  isBookmarked: articles.isBookmarked,
  isReadLater: articles.isReadLater,
  isFavorite: articles.isFavorite,
  createdAt: articles.createdAt,
} as const

/**
 * Narrower still, for public/shared reads.
 *
 * The per-user reading flags (`isUsed`, `visitCount`, `isBookmarked`,
 * `isReadLater`, `isFavorite`) are workspace-private state that a stranger with
 * a share link has no business seeing, and the reader renders a guest's own
 * favourites from local storage anyway.
 */
export const ARTICLE_PUBLIC_COLUMNS = {
  id: articles.id,
  feedId: articles.feedId,
  title: articles.title,
  description: articles.description,
  link: articles.link,
  image: articles.image,
  publishedAt: articles.publishedAt,
  createdAt: articles.createdAt,
} as const
