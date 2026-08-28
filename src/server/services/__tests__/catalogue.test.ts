import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { flattenCatalogue, syncCatalogue } from '../catalogue'
import type { createClient } from '@libsql/client'
import type {Database} from '@/db/client';
import {  createDb } from '@/db/client'
import { catalogueCollections, catalogueFeeds } from '@/db/schema'

/**
 * The catalogue sync has one invariant that cannot be seen by reading it: a
 * re-sync must overwrite the curated columns and leave the cached ones alone.
 * Get that wrong and every deploy silently wipes the article counts, the
 * statuses and the import counters — the page still renders, it just quietly
 * goes blank until the next refresh. Nothing in typechecking catches it.
 *
 * Runs against a real SQLite database for the second reason too: `db/client.ts`
 * casts the libsql handle to a Postgres one, so `onConflictDoUpdate` with
 * `excluded.` has to survive that cast. Demo mode is exactly this arrangement.
 */

async function freshDb(): Promise<Database> {
  const handle = createDb(':memory:', { sqlite: true })
  const raw = (handle as unknown as { $client: ReturnType<typeof createClient> }).$client

  await raw.execute(`CREATE TABLE catalogue_collections (
    slug text PRIMARY KEY NOT NULL, category text NOT NULL, name text NOT NULL,
    description text NOT NULL, site_url text, cover_file text, accent text,
    sort_order integer NOT NULL DEFAULT 0, import_count integer NOT NULL DEFAULT 0,
    retired_at text, created_at text)`)
  await raw.execute(`CREATE TABLE catalogue_feeds (
    slug text PRIMARY KEY NOT NULL, category text NOT NULL, collection_slug text,
    name text NOT NULL, description text NOT NULL, feed_url text NOT NULL,
    site_url text, icon_file text, accent text, sort_order integer NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'unknown', failure_streak integer NOT NULL DEFAULT 0,
    last_checked_at text, last_error text, article_count integer, latest_title text,
    latest_published_at text, articles_fetched_at text, articles_error text,
    import_count integer NOT NULL DEFAULT 0,
    retired_at text, created_at text)`)

  return handle
}

describe('catalogue sync', () => {
  it('materialises the file into rows', async () => {
    const db = await freshDb()
    const flat = flattenCatalogue()

    await syncCatalogue(db)

    const collections = await db.select().from(catalogueCollections)
    const feeds = await db.select().from(catalogueFeeds)
    expect(collections.length).toBe(flat.collections.length)
    expect(feeds.length).toBe(flat.feeds.length)
  })

  it('is idempotent — running twice changes no counts', async () => {
    const db = await freshDb()
    await syncCatalogue(db)
    const first = (await db.select().from(catalogueFeeds)).length

    await syncCatalogue(db)

    expect((await db.select().from(catalogueFeeds)).length).toBe(first)
  })

  it('overwrites curated columns on re-sync', async () => {
    const db = await freshDb()
    await syncCatalogue(db)
    const [target] = await db.select().from(catalogueFeeds).limit(1)

    // Simulate a stale row: someone edited the description in the file.
    await db
      .update(catalogueFeeds)
      .set({ description: 'stale text from a previous deploy' })
      .where(eq(catalogueFeeds.slug, target.slug))

    await syncCatalogue(db)

    const [after] = await db
      .select()
      .from(catalogueFeeds)
      .where(eq(catalogueFeeds.slug, target.slug))
    expect(after.description).toBe(target.description)
  })

  it('leaves cached columns alone on re-sync', async () => {
    // The whole reason this file exists.
    const db = await freshDb()
    await syncCatalogue(db)
    const [target] = await db.select().from(catalogueFeeds).limit(1)

    await db
      .update(catalogueFeeds)
      .set({
        status: 'ok',
        failureStreak: 2,
        articleCount: 142,
        latestTitle: 'Something published yesterday',
        importCount: 7,
        lastCheckedAt: '2026-08-05T00:00:00.000Z',
      })
      .where(eq(catalogueFeeds.slug, target.slug))

    await syncCatalogue(db)

    const [after] = await db
      .select()
      .from(catalogueFeeds)
      .where(eq(catalogueFeeds.slug, target.slug))
    expect(after.status).toBe('ok')
    expect(after.failureStreak).toBe(2)
    expect(after.articleCount).toBe(142)
    expect(after.latestTitle).toBe('Something published yesterday')
    expect(after.importCount).toBe(7)
    expect(after.lastCheckedAt).toBe('2026-08-05T00:00:00.000Z')
  })

  it('retires a row the file no longer lists, without deleting it', async () => {
    const db = await freshDb()
    await syncCatalogue(db)

    // A slug that curation dropped: present in the table, absent from the file.
    await db.insert(catalogueFeeds).values({
      slug: 'gone-from-the-file',
      category: 'ai',
      name: 'Removed',
      description: 'No longer curated',
      feedUrl: 'https://example.com/rss',
      importCount: 12,
    })

    await syncCatalogue(db)

    const [row] = await db
      .select()
      .from(catalogueFeeds)
      .where(eq(catalogueFeeds.slug, 'gone-from-the-file'))
    expect(row).toBeDefined()          // soft delete, not a delete
    expect(row.retiredAt).toBeTruthy()
    expect(row.importCount).toBe(12)   // counters survive
  })

  it('un-retires a row that comes back', async () => {
    const db = await freshDb()
    await syncCatalogue(db)
    const [target] = await db.select().from(catalogueFeeds).limit(1)

    await db
      .update(catalogueFeeds)
      .set({ retiredAt: '2026-01-01T00:00:00.000Z' })
      .where(eq(catalogueFeeds.slug, target.slug))

    await syncCatalogue(db)

    const [after] = await db
      .select()
      .from(catalogueFeeds)
      .where(eq(catalogueFeeds.slug, target.slug))
    expect(after.retiredAt).toBeNull()
  })

  it('never lets an unresolved entry reach the table', () => {
    // Entries are authored with siteUrl only; catalogue-validate fills in the
    // feed URL. Until it has, they must not be flattened — feed_url is NOT NULL,
    // and a card that cannot be imported is worse than no card.
    const { feeds, unresolved } = flattenCatalogue()

    expect(feeds.every((f) => typeof f.feedUrl === 'string' && f.feedUrl.length > 0)).toBe(true)
    for (const slug of unresolved) {
      expect(feeds.find((f) => f.slug === slug)).toBeUndefined()
    }
  })

  it('ships a fully resolved catalogue', () => {
    // Not a property of the code, a property of the content: every entry should
    // have been through catalogue-validate before it lands. This fails loudly
    // when someone hand-adds a source and forgets to run it.
    const { unresolved } = flattenCatalogue()
    expect(unresolved).toEqual([])
  })

  it('has no duplicate feed URLs', () => {
    // Two cards importing the same feed is a curation bug the validator also
    // catches, but it is cheap to hold the line here too.
    const { feeds } = flattenCatalogue()
    const seen = new Set<string>()
    for (const f of feeds) {
      expect(seen.has(f.feedUrl), `duplicate: ${f.feedUrl}`).toBe(false)
      seen.add(f.feedUrl)
    }
  })
})
