import {  sql } from 'drizzle-orm'
import { invalidArgument } from './errors'
import type {SQL} from 'drizzle-orm';
import { articles } from '@/db/schema'

/**
 * Keyset pagination.
 *
 * Not OFFSET: it is the same amount of work to write, stays correct when rows
 * are inserted mid-pagination (feeds refresh constantly), and does not get
 * slower with depth. The cursor is the sort value plus the id, which together
 * are unique and so give a total order.
 */

export interface Cursor {
  /** The sort value of the last row returned. */
  v: string
  /** Tie-breaker for rows sharing a sort value. */
  id: string
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

export function decodeCursor(value: string): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (typeof parsed?.v !== 'string' || typeof parsed?.id !== 'string') {
      throw new Error('shape')
    }
    return parsed
  } catch {
    throw invalidArgument('Malformed cursor. Omit it to start from the beginning.')
  }
}

/**
 * The article sort key.
 *
 * `published_at` is nullable text: `fetch-articles.ts` writes null when a feed
 * item has no date, and `getAllData` papers over it in JS with a `createdAt`
 * fallback. A keyset on the bare column would drop every one of those rows
 * silently, so the coalesce is part of the sort key rather than a detail.
 */
export const ARTICLE_SORT_KEY = sql`coalesce(${articles.publishedAt}, ${articles.createdAt})`

/**
 * `WHERE (sortKey, id) < (cursor.v, cursor.id)` for a DESC sort, written as the
 * expanded comparison because SQLite has no row-value comparison.
 */
export function keysetWhere(sortKey: SQL, idCol: SQL | unknown, cursor: Cursor): SQL {
  return sql`(${sortKey} < ${cursor.v} or (${sortKey} = ${cursor.v} and ${idCol} < ${cursor.id}))`
}

export const DEFAULT_LIMIT = 20
export const MAX_LIMIT = 50

export function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT
  if (!Number.isFinite(limit) || limit < 1) {
    throw invalidArgument(`limit must be between 1 and ${MAX_LIMIT}.`)
  }
  return Math.min(Math.floor(limit), MAX_LIMIT)
}

/**
 * Splits a `LIMIT n+1` result into the page and its cursor.
 *
 * Fetching one extra row is how `hasMore` is known without a second COUNT
 * query, which on a joined article query is the expensive part.
 */
export function takePage<T>(
  rows: Array<T>,
  limit: number,
  cursorOf: (row: T) => Cursor,
): { items: Array<T>; nextCursor: string | null } {
  if (rows.length <= limit) return { items: rows, nextCursor: null }
  const items = rows.slice(0, limit)
  return { items, nextCursor: encodeCursor(cursorOf(items[items.length - 1])) }
}
