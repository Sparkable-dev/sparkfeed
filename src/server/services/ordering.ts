import { sql } from 'drizzle-orm'
import { feeds, folders } from '@/db/schema'

/**
 * The order the sidebar and `/sources` agree on, defined once.
 *
 * `nulls last` is not decoration. Postgres sorts nulls last on `ASC`; SQLite
 * sorts them **first**, and demo mode runs these Postgres table objects against
 * SQLite (see the cast in `db/client.ts`). A bare `ORDER BY position, createdAt`
 * therefore puts never-dragged rows at the top in demo and at the bottom in
 * production — the two environments quietly disagree. Verified against both
 * engines: SQLite 3.51 and the installed libsql (3.45.1) both honour the
 * keyword, which has existed since SQLite 3.30.
 *
 * Drizzle has no `nullsLast()` for `orderBy` — the ones in `pg-core` build
 * indexes, not sort keys — so this has to be a raw fragment. Hence one seam
 * rather than the same `sql` template copied across seven call sites.
 *
 * If an older or exotic engine ever appears, `coalesce(position, 2147483647)`
 * is a drop-in with identical results and no keyword dependency. The test
 * beside this file is what would catch the need.
 *
 * Spread into the call: `.orderBy(...FEED_ORDER)`.
 */
export const FOLDER_ORDER = [
  sql`${folders.position} nulls last`,
  folders.createdAt,
] as const

export const FEED_ORDER = [
  sql`${feeds.position} nulls last`,
  feeds.createdAt,
] as const
