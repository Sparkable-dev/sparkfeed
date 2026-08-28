import { createClient } from '@libsql/client'
import { drizzle as drizzleSQLite } from 'drizzle-orm/libsql'
import postgres from 'postgres'
import { drizzle as drizzlePG } from 'drizzle-orm/postgres-js'
import * as schema from './schema'   // always the PG schema (re-exports schema.pg.ts)
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

/**
 * Database construction, with no side effects at import time.
 *
 * Split from `index.ts` because that module builds a singleton and throws when
 * DATABASE_URL is unset. Anything importing it just to reach the factory (a
 * test, a script) would crash before running a line of its own code.
 */

/**
 * One database type for both dialects.
 *
 * The SQLite client is cast to the PG interface because the Drizzle query
 * builder emits identical SQL for plain SELECT/INSERT/UPDATE/DELETE regardless
 * of client. That equivalence is real but narrow: it breaks the moment a query
 * uses a dialect-specific `sql` fragment (tsvector, ILIKE,
 * FOR UPDATE SKIP LOCKED, generated columns). Anything like that belongs behind
 * a seam, not inline in a service.
 */
export type Database = PostgresJsDatabase<typeof schema>

export function createDb(url: string, opts: { sqlite?: boolean } = {}): Database {
  return opts.sqlite
    ? (drizzleSQLite(createClient({ url }), { schema }) as unknown as Database)
    : drizzlePG(postgres(url), { schema })
}

export { schema }
