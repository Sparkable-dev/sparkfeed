import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'
import { sanitizeArticleHtml } from '../utils/extract'
import { loadReaderPreview } from '../utils/reader-preview'
import { htmlToMarkdown, htmlToPlainText } from './markdown'
import { decodeArticleId, decodeId, encodeId } from './ids'
import { articleInWorkspace } from './tenancy'
import { SEARCH_MODE, articleTextMatch } from './dialect'
import { apiFavoriteCondition } from './favorites'
import {
  ARTICLE_SORT_KEY,

  clampLimit,
  decodeCursor,
  encodeCursor,
  keysetWhere,
  takePage
} from './pagination'
import { withBudget } from './budget'
import { invalidArgument, notFound } from './errors'
import type {Cursor} from './pagination';
import type { ApiPrincipal } from '../api/principal'
import { articles, feeds, folders } from '@/db/schema'
import { db } from '@/db/index'

const SNIPPET_CHARS = 300

export interface SearchArgs {
  query?: string
  folderId?: string
  feedId?: string
  since?: string
  until?: string
  favoritesOnly?: boolean
  unreadOnly?: boolean
  limit?: number
  cursor?: string
}

/**
 * One search tool rather than a separate "list recent".
 *
 * `query` is optional: omitting it gives most-recent-first, which is the single
 * most common agent request ("what is new in my AI folder this week"). Two
 * near-identical tools would just make the model choose badly between them.
 *
 * Returns metadata and a 300-character snippet only. Full text is always an
 * explicit `get_article` call, which is the whole answer to "never send huge
 * responses": the expensive operation is opt-in and singular.
 */
export async function searchArticles(principal: ApiPrincipal, args: SearchArgs) {
  const limit = clampLimit(args.limit)
  const conditions = [articleInWorkspace(principal.workspaceId)]
  const favorite = await apiFavoriteCondition(principal)

  if (args.query?.trim()) conditions.push(articleTextMatch(args.query.trim()))
  if (args.favoritesOnly) conditions.push(favorite)
  if (args.unreadOnly) conditions.push(eq(articles.isUsed, false))
  if (args.since) conditions.push(gte(ARTICLE_SORT_KEY, isoDate(args.since, 'since')))
  if (args.until) conditions.push(lte(ARTICLE_SORT_KEY, isoDate(args.until, 'until')))

  if (args.feedId) {
    conditions.push(eq(articles.feedId, decodeId('feed', args.feedId)))
  }

  if (args.folderId) {
    const folderRaw = decodeId('folder', args.folderId)
    conditions.push(
      sql`exists (select 1 from ${feeds} where ${feeds.id} = ${articles.feedId}
        and ${feeds.folderId} = ${folderRaw})`,
    )
  }

  if (args.cursor) {
    conditions.push(keysetWhere(ARTICLE_SORT_KEY, articles.id, decodeCursor(args.cursor)))
  }

  // limit + 1 so hasMore is known without a second COUNT over the join.
  const rows = await db
    .select({
      id: articles.id,
      title: articles.title,
      link: articles.link,
      description: articles.description,
      publishedAt: articles.publishedAt,
      createdAt: articles.createdAt,
      isFavorite: sql<boolean>`case when ${favorite} then true else false end`,
      isUsed: articles.isUsed,
      hasContent: sql<number>`case when ${articles.content} is null then 0 else 1 end`,
      feedId: feeds.id,
      feedName: feeds.name,
      folderId: feeds.folderId,
      folderName: folders.name,
    })
    .from(articles)
    .innerJoin(feeds, eq(feeds.id, articles.feedId))
    .leftJoin(folders, eq(folders.id, feeds.folderId))
    .where(and(...conditions))
    .orderBy(desc(ARTICLE_SORT_KEY), desc(articles.id))
    .limit(limit + 1)

  const cursorOf = (row: (typeof rows)[number]): Cursor => ({
    v: row.publishedAt ?? row.createdAt ?? '',
    id: row.id,
  })

  const page = takePage(rows, limit, cursorOf)
  const shaped = page.items.map((row) => ({
    id: encodeId('article', row.id),
    title: row.title,
    url: row.link,
    source: { feed_id: encodeId('feed', row.feedId), name: row.feedName },
    folder: row.folderId
      ? { id: encodeId('folder', row.folderId), name: row.folderName }
      : null,
    published_at: row.publishedAt ?? row.createdAt,
    snippet: snippet(row.description),
    is_favorite: !!row.isFavorite,
    is_read: !!row.isUsed,
    // Tells the agent whether get_article will be instant or will need a live
    // fetch. Small field, meaningfully better pacing.
    has_full_text: Number(row.hasContent) === 1,
  }))

  const budgeted = withBudget(shaped, {
    nextCursor: page.nextCursor,
    cursorOf: (item) => ({ v: item.published_at ?? '', id: decodeId('article', item.id) }),
  })

  return {
    articles: budgeted.items,
    next_cursor: budgeted.nextCursor,
    truncated: budgeted.truncated,
    // Reported rather than assumed: in demo this is substring matching, and an
    // agent told "relevance" when it got recency would draw wrong conclusions.
    search_mode: args.query?.trim() ? SEARCH_MODE : 'newest',
    ...(budgeted.hint ? { hint: budgeted.hint } : {}),
  }
}

export interface GetArticleArgs {
  id: string
  format?: 'markdown' | 'text' | 'html'
  maxChars?: number
  offset?: number
}

const DEFAULT_MAX_CHARS = 50_000
const HARD_MAX_CHARS = 80_000

/**
 * One article, in full. Deliberately singular.
 *
 * Resolution order: cached `articles.content`, then a live fetch plus
 * Readability extraction (cached back), then the RSS description as a last
 * resort. The middle step is what makes this work when nobody has ever opened
 * the article in the web app, which is the whole point of the MCP server.
 *
 * In demo the live fetch is skipped entirely rather than restricted: the demo
 * key is public, and a public endpoint that fetches arbitrary stored URLs on
 * request is an open proxy. Most demo articles carry `content:encoded` from
 * ingest anyway, so cached text is usually there.
 */
export async function getArticle(principal: ApiPrincipal, args: GetArticleArgs) {
  const format = args.format ?? 'markdown'
  const maxChars = Math.min(args.maxChars ?? DEFAULT_MAX_CHARS, HARD_MAX_CHARS)
  const offset = Math.max(args.offset ?? 0, 0)

  /*
    `scr_` ids still decode, because one may be sitting in a saved conversation,
    but they no longer name a separate table. An article from a watched page is
    an ordinary `articles` row, read by this same path with the same cached full
    text — which is a real gain: `scraped_articles` had no `content` column at
    all, so the first paragraph was the most an agent could ever be given.
  */
  const { raw } = decodeArticleId(args.id)

  const [row] = await db
    .select({
      id: articles.id,
      title: articles.title,
      link: articles.link,
      content: articles.content,
      contentErrorAt: articles.contentErrorAt,
      contentSource: articles.contentSource,
      feedUrl: feeds.url,
      sourceKind: feeds.kind,
      description: articles.description,
      publishedAt: articles.publishedAt,
      createdAt: articles.createdAt,
      feedName: feeds.name,
    })
    .from(articles)
    .innerJoin(feeds, eq(feeds.id, articles.feedId))
    .where(and(eq(articles.id, raw), articleInWorkspace(principal.workspaceId)))
    .limit(1)

  if (!row) throw notFound('Article')

  let html = row.content ?? null
  let quality: 'extracted' | 'rss_description' | 'failed' = 'extracted'

  if (!principal.demo) {
    const preview = await loadReaderPreview({
      ...row,
      feedUrl: row.sourceKind === 'page' ? null : row.feedUrl,
    })
    html = preview.readerHtml
    if (preview.quality === 'summary') quality = 'rss_description'
    if (preview.cacheUpdate) {
      await db.update(articles).set(preview.cacheUpdate)
        .where(and(eq(articles.id, raw), articleInWorkspace(principal.workspaceId)))
        .catch(() => {})
    }
  }

  if (!html && row.description) {
    html = sanitizeArticleHtml(row.description, row.link)
    quality = 'rss_description'
  }

  if (!html) {
    quality = 'failed'
    html = ''
  }

  const rendered =
    format === 'html' ? html : format === 'text' ? htmlToPlainText(html) : htmlToMarkdown(html)

  const slice = rendered.slice(offset, offset + maxChars)
  const truncated = offset + slice.length < rendered.length

  return {
    id: encodeId('article', row.id),
    title: row.title,
    url: row.link,
    source: row.feedName,
    published_at: row.publishedAt ?? row.createdAt,
    format,
    content: slice,
    word_count: rendered.trim() ? rendered.trim().split(/\s+/).length : 0,
    truncated,
    next_offset: truncated ? offset + slice.length : null,
    source_quality: quality,
  }
}


function snippet(description: string | null): string {
  if (!description) return ''
  const text = htmlToPlainText(description).replace(/\s+/g, ' ').trim()
  return text.length > SNIPPET_CHARS ? `${text.slice(0, SNIPPET_CHARS).trimEnd()}…` : text
}

/** Accepts an ISO date or a relative shorthand like `7d` / `24h`. */
function isoDate(value: string, field: string): string {
  const relative = value.match(/^(\d+)([dh])$/)
  if (relative) {
    const n = Number(relative[1])
    const ms = relative[2] === 'd' ? n * 86_400_000 : n * 3_600_000
    return new Date(Date.now() - ms).toISOString()
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw invalidArgument(`${field} must be an ISO date or a relative value like "7d" or "24h".`)
  }
  return parsed.toISOString()
}

export { encodeCursor }
