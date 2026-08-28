import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import type * as FetchArticles from '@/server/utils/fetch-articles'
import type { createClient } from '@libsql/client'
import type {Database} from '@/db/client';
import {  createDb } from '@/db/client'
import { catalogueArticles, catalogueFeeds } from '@/db/schema'

/**
 * The preview cache is the one part of Discover that does network I/O while a
 * user waits, and almost everything that can go wrong with it is invisible when
 * reading the code: a stampede on a cold cache, a dead feed refetched forever, a
 * single 403 taking down its healthy siblings, or — worst — a preview marking a
 * feed dead and deleting that card from Discover for every user.
 *
 * Runs against real SQLite through the same cast demo mode uses.
 */

const fetchFeedItems = vi.hoisted(() => vi.fn())

vi.mock('@/server/utils/fetch-articles', async () => {
  const actual = await vi.importActual<typeof FetchArticles>(
    '@/server/utils/fetch-articles',
  )
  return { ...actual, fetchFeedItems }
})
// The service calls this on entry; the sync itself is covered by catalogue.test.
vi.mock('../catalogue', () => ({ ensureCatalogueSynced: () => Promise.resolve() }))

const { getCataloguePreview, __resetPreviewState } = await import('../catalogue-preview')

async function freshDb(): Promise<Database> {
  const handle = createDb(':memory:', { sqlite: true })
  const raw = (handle as unknown as { $client: ReturnType<typeof createClient> }).$client

  await raw.execute(`CREATE TABLE catalogue_feeds (
    slug text PRIMARY KEY NOT NULL, category text NOT NULL, collection_slug text,
    name text NOT NULL, description text NOT NULL, feed_url text NOT NULL,
    site_url text, icon_file text, accent text, sort_order integer NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'unknown', failure_streak integer NOT NULL DEFAULT 0,
    last_checked_at text, last_error text, article_count integer, latest_title text,
    latest_published_at text, articles_fetched_at text, articles_error text,
    import_count integer NOT NULL DEFAULT 0, retired_at text, created_at text)`)
  await raw.execute(`CREATE TABLE catalogue_articles (
    feed_slug text NOT NULL, link text NOT NULL, title text NOT NULL,
    description text, image text, published_at text,
    sort_order integer NOT NULL DEFAULT 0, fetched_at text,
    PRIMARY KEY (feed_slug, link))`)

  return handle
}

async function addFeed(
  db: Database,
  slug: string,
  extra: Partial<typeof catalogueFeeds.$inferInsert> = {},
) {
  await db.insert(catalogueFeeds).values({
    slug,
    category: 'ai',
    name: slug,
    description: 'x',
    feedUrl: `https://example.com/${slug}.xml`,
    ...extra,
  })
}

function item(link: string, isoDate?: string) {
  return { link, title: `Title ${link}`, isoDate, contentSnippet: 'snippet' }
}

beforeEach(() => {
  __resetPreviewState()
  fetchFeedItems.mockReset()
})
afterEach(() => vi.useRealTimers())

describe('catalogue preview', () => {
  it('fetches on a cold cache and serves from cache afterwards', async () => {
    const db = await freshDb()
    await addFeed(db, 'a')
    fetchFeedItems.mockResolvedValue([item('l1', '2026-08-01T00:00:00.000Z')])

    const first = await getCataloguePreview('feed', 'a', db)
    expect(first.feeds[0].state).toBe('ok')
    expect(first.feeds[0].articles).toHaveLength(1)
    expect(fetchFeedItems).toHaveBeenCalledTimes(1)

    const second = await getCataloguePreview('feed', 'a', db)
    expect(second.feeds[0].articles).toHaveLength(1)
    // Still one: the TTL has not expired, so no second fetch.
    expect(fetchFeedItems).toHaveBeenCalledTimes(1)
  })

  it('collapses concurrent cold opens into a single fetch', async () => {
    const db = await freshDb()
    await addFeed(db, 'a')
    let release: (v: unknown) => void = () => {}
    const gate = new Promise((r) => (release = r))
    fetchFeedItems.mockImplementation(async () => {
      await gate
      return [item('l1')]
    })

    const all = Promise.all(
      Array.from({ length: 5 }, () => getCataloguePreview('feed', 'a', db)),
    )
    release(null)
    const results = await all

    expect(fetchFeedItems).toHaveBeenCalledTimes(1)
    for (const r of results) expect(r.feeds[0].articles).toHaveLength(1)
    // And exactly one set of rows, not five.
    expect(await db.select().from(catalogueArticles)).toHaveLength(1)
  })

  it('lets healthy feeds in a collection survive a broken sibling', async () => {
    const db = await freshDb()
    await addFeed(db, 'good', { collectionSlug: 'c' })
    await addFeed(db, 'bad', { collectionSlug: 'c' })
    fetchFeedItems.mockImplementation(async (url: string) => {
      if (url.includes('bad')) throw new Error('403 Forbidden')
      return [item('l1')]
    })

    const res = await getCataloguePreview('collection', 'c', db)

    expect(res.feeds).toHaveLength(2)
    expect(res.feeds.find((f) => f.slug === 'good')?.state).toBe('ok')
    expect(res.feeds.find((f) => f.slug === 'bad')?.state).toBe('unavailable')
  })

  it('stamps the timestamp even when the fetch fails, so a dead feed backs off', async () => {
    const db = await freshDb()
    await addFeed(db, 'a')
    fetchFeedItems.mockRejectedValue(new Error('nope'))

    await getCataloguePreview('feed', 'a', db)
    const [row] = await db.select().from(catalogueFeeds).where(eq(catalogueFeeds.slug, 'a'))
    expect(row.articlesFetchedAt).not.toBeNull()
    expect(row.articlesError).toContain('nope')

    __resetPreviewState()
    await getCataloguePreview('feed', 'a', db)
    // No second attempt: the failure counts against the TTL like a success.
    expect(fetchFeedItems).toHaveBeenCalledTimes(1)
  })

  it('never writes the health columns the catalogue read filters on', async () => {
    const db = await freshDb()
    await addFeed(db, 'a', { status: 'ok' })
    fetchFeedItems.mockRejectedValue(new Error('transient blip'))

    await getCataloguePreview('feed', 'a', db)

    const [row] = await db.select().from(catalogueFeeds).where(eq(catalogueFeeds.slug, 'a'))
    // If a preview could flip this to 'dead', one blip would remove the card
    // from Discover for every user in the product.
    expect(row.status).toBe('ok')
    expect(row.failureStreak).toBe(0)
  })

  it('replaces rather than accumulates on refresh', async () => {
    const db = await freshDb()
    await addFeed(db, 'a')
    fetchFeedItems.mockResolvedValue([item('l1'), item('l2')])
    await getCataloguePreview('feed', 'a', db)

    // Age the cache past the TTL and drop an item from the feed.
    await db
      .update(catalogueFeeds)
      .set({ articlesFetchedAt: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString() })
      .where(eq(catalogueFeeds.slug, 'a'))
    fetchFeedItems.mockResolvedValue([item('l2')])

    __resetPreviewState()
    await getCataloguePreview('feed', 'a', db)
    // The detached revalidation is fire-and-forget; let it land.
    await vi.waitFor(async () => {
      expect(await db.select().from(catalogueArticles)).toHaveLength(1)
    })
  })

  it('sorts newest first regardless of the order the feed listed them', async () => {
    const db = await freshDb()
    await addFeed(db, 'a')
    fetchFeedItems.mockResolvedValue([
      item('old', '2026-01-01T00:00:00.000Z'),
      item('new', '2026-08-01T00:00:00.000Z'),
    ])

    const res = await getCataloguePreview('feed', 'a', db)
    expect(res.feeds[0].articles.map((a) => a.link)).toEqual(['new', 'old'])
  })

  it('distinguishes a quiet feed from a broken one', async () => {
    const db = await freshDb()
    await addFeed(db, 'a')
    fetchFeedItems.mockResolvedValue([])

    const res = await getCataloguePreview('feed', 'a', db)
    expect(res.feeds[0].state).toBe('empty')
  })

  it('ignores retired and dead entries, matching the catalogue read', async () => {
    const db = await freshDb()
    await addFeed(db, 'live', { collectionSlug: 'c' })
    await addFeed(db, 'retired', { collectionSlug: 'c', retiredAt: '2026-01-01' })
    await addFeed(db, 'dead', { collectionSlug: 'c', status: 'dead' })
    fetchFeedItems.mockResolvedValue([item('l1')])

    const res = await getCataloguePreview('collection', 'c', db)
    expect(res.feeds.map((f) => f.slug)).toEqual(['live'])
  })
})
