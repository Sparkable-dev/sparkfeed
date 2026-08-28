import {  sql } from 'drizzle-orm'
import type {SQL} from 'drizzle-orm';
import { articles } from '@/db/schema'
import { DEMO_MODE } from '@/lib/demo'

/**
 * The one place Postgres and SQLite are allowed to differ.
 *
 * The app runs Postgres in production and SQLite in demo, through the same
 * Drizzle table definitions (see `src/db/client.ts`). That works because the
 * query builder emits identical SQL for ordinary statements. It stops working
 * for anything dialect-specific, and rather than let those branches spread
 * through the services they are collected here.
 *
 * The check is a module-level constant so the bundler can eliminate the unused
 * branch: `VITE_DEMO_MODE` is inlined at build time, and demo and production
 * are separate artifacts.
 */
const SQLITE = DEMO_MODE

/** Which search implementation is live, so responses can report it honestly. */
export const SEARCH_MODE: 'fulltext' | 'substring' = SQLITE ? 'substring' : 'fulltext'

/**
 * Matches a free-text query against an article's title and description.
 *
 * Postgres uses ILIKE for now rather than tsvector. The GIN index is M2 work,
 * and at current row counts the difference is imperceptible; keeping v1 free of
 * a hand-written migration is worth more than the index. When it lands, only
 * this function changes.
 */
export function articleTextMatch(query: string): SQL {
  const pattern = `%${escapeLike(query)}%`
  if (SQLITE) {
    // SQLite's LIKE is case-insensitive for ASCII by default; lower() makes
    // that explicit and consistent with the Postgres branch.
    return sql`(lower(${articles.title}) like lower(${pattern}) escape '\\'
      or lower(coalesce(${articles.description}, '')) like lower(${pattern}) escape '\\')`
  }
  return sql`(${articles.title} ilike ${pattern} escape '\\'
    or coalesce(${articles.description}, '') ilike ${pattern} escape '\\')`
}

/** `%`, `_` and the escape character itself are literals in a user's query. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`)
}
