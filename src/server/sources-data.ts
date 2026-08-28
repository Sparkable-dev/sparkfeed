import { createServerFn } from "@tanstack/react-start"
import { feedHealthByFeed } from "./services/feed-health"
import { requeueUnfetchedFrom } from "./services/feed-write"
import { resolveWorkspaceContext } from "./services/context"
import { feedInWorkspace } from "./services/tenancy"
import { FEED_ORDER } from "./services/ordering"
import { db } from "@/db/index"
import { feeds } from "@/db/schema"

/**
 * The health half of `/sources`.
 *
 * Folders and feeds themselves come from `getAllData`, which the route loads
 * anyway to render the shell — asking for them twice would be two queries for
 * one answer, and worse, two answers that could disagree about order. This
 * supplies only what `getAllData` does not carry: how often each feed publishes
 * and when it last did.
 *
 * Keyed by feed id rather than returned as a list, because the page joins it
 * onto rows it already has rather than rendering it directly.
 */

/**
 * Everything `@/lib/source-health` needs to classify a feed, in one row.
 *
 * The error and creation columns ride along with the publishing window rather
 * than being widened into `getAllData`: the sidebar has no use for them, and
 * this is the only page that renders a status dot per feed.
 */
export interface SourceHealthRow {
  posts30d: number
  firstAt30d: string | null
  lastAt30d: string | null
  lastPostAt: string | null
  lastError: string | null
  lastErrorAt: string | null
  lastFetchedAt: string | null
  createdAt: string | null
}

export const getSourceHealth = createServerFn({ method: "GET" }).handler(
  async (): Promise<Record<string, SourceHealthRow>> => {
    const { workspaceId } = await resolveWorkspaceContext()

    const rows = await db
      .select({
        id: feeds.id,
        // `url` is not rendered — it is here so a feed that never got fetched
        // can be re-queued below without a second query.
        url: feeds.url,
        kind: feeds.kind,
        lastError: feeds.lastError,
        lastErrorAt: feeds.lastErrorAt,
        lastFetchedAt: feeds.lastFetchedAt,
        createdAt: feeds.createdAt,
      })
      .from(feeds)
      .where(feedInWorkspace(workspaceId))
      .orderBy(...FEED_ORDER)

    /*
      A feed inserted but never attempted lost its turn in the ingest queue,
      which does not survive a deploy. This is the page where that shows up as a
      row reading "Never", so it is also the sensible place to quietly try
      again — and the rows above already carry the two columns that say so, so
      the recovery costs no extra query.
    */
    requeueUnfetchedFrom(
      rows.map((r) => ({
        id: r.id,
        url: r.url,
        kind: r.kind,
        lastFetchedAt: r.lastFetchedAt,
        lastErrorAt: r.lastErrorAt,
      })),
    )

    const windows = await feedHealthByFeed(
      db,
      rows.map((r) => r.id),
    )

    // A plain object rather than a Map: this crosses the server-fn boundary,
    // and a Map does not survive that serialisation.
    return Object.fromEntries(
      rows.map((row) => {
        const w = windows.get(row.id)
        return [
          row.id,
          {
            posts30d: w?.posts30d ?? 0,
            firstAt30d: w?.firstAt30d ?? null,
            lastAt30d: w?.lastAt30d ?? null,
            lastPostAt: w?.lastPostAt ?? null,
            lastError: row.lastError ?? null,
            lastErrorAt: row.lastErrorAt ?? null,
            lastFetchedAt: row.lastFetchedAt ?? null,
            createdAt: row.createdAt ?? null,
          } satisfies SourceHealthRow,
        ]
      }),
    )
  },
)
