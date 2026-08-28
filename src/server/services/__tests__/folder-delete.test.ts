import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { collectFolderSubtree, deleteFolderTree } from '../folder-delete'
import type { createClient } from '@libsql/client'
import type {Database} from '@/db/client';
import {  createDb } from '@/db/client'
import {
  articles,
  feedShares,
  feeds,
  folderShares,
  folders,
} from '@/db/schema'

/**
 * Deleting a folder is entirely manual — no foreign key in this schema
 * cascades, and the scraped tables have no foreign keys at all — so what
 * survives a delete is decided by the order of statements below and nothing
 * else. Run against a real database for the same reason tenancy.test.ts is:
 * this logic reads correctly and still used to leave rows behind.
 */

const WS = 'workspace-a'

async function freshDb(): Promise<Database> {
  const handle = createDb(':memory:', { sqlite: true })
  const raw = (handle as unknown as { $client: ReturnType<typeof createClient> }).$client

  await raw.execute(`CREATE TABLE folders (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    workspace_id TEXT, parent_id TEXT, position INTEGER, created_at TEXT)`)
  await raw.execute(`CREATE TABLE feeds (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL,
    folder_id TEXT, workspace_id TEXT, kind TEXT DEFAULT 'rss', include_keywords TEXT,
    exclude_keywords TEXT, position INTEGER, created_at TEXT,
    last_fetched_at TEXT, last_error TEXT, last_error_at TEXT)`)
  await raw.execute(`CREATE TABLE articles (
    id TEXT PRIMARY KEY, feed_id TEXT, title TEXT NOT NULL, description TEXT,
    content TEXT, content_fetched_at TEXT, link TEXT NOT NULL, image TEXT,
    published_at TEXT, is_used INTEGER, visit_count INTEGER,
    is_bookmarked INTEGER, is_read_later INTEGER, is_favorite INTEGER,
    created_at TEXT)`)
  await raw.execute(`CREATE TABLE folder_shares (
    folder_id TEXT PRIMARY KEY, is_shared INTEGER NOT NULL DEFAULT 0,
    password TEXT, created_at TEXT)`)
  await raw.execute(`CREATE TABLE feed_shares (
    feed_id TEXT PRIMARY KEY, is_shared INTEGER NOT NULL DEFAULT 0,
    password TEXT, created_at TEXT)`)
  await raw.execute(`CREATE TABLE scraped_feeds (
    id TEXT PRIMARY KEY, workspace_id TEXT, folder_id TEXT,
    site_url TEXT NOT NULL UNIQUE, title TEXT, last_hash TEXT,
    created_at TEXT, last_fetched_at TEXT, last_error TEXT, last_error_at TEXT)`)
  await raw.execute(`CREATE TABLE scraped_articles (
    id TEXT PRIMARY KEY, workspace_id TEXT, folder_id TEXT,
    site_url TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL UNIQUE,
    date TEXT, description TEXT, created_at TEXT)`)

  return handle
}

/** A folder with one RSS feed (plus article and share) and one scraped source. */
async function seedFolder(
  db: Database,
  id: string,
  opts: { parentId?: string | null } = {},
) {
  await db.insert(folders).values({
    id, name: id, workspaceId: WS, parentId: opts.parentId ?? null,
  })
  await db.insert(folderShares).values({ folderId: id, isShared: true })

  await db.insert(feeds).values({
    id: `${id}-feed`, name: `${id} feed`, url: `https://${id}.example/rss`,
    folderId: id, workspaceId: WS,
  })
  await db.insert(feedShares).values({ feedId: `${id}-feed`, isShared: true })
  await db.insert(articles).values({
    id: `${id}-article`, feedId: `${id}-feed`, title: 't',
    link: `https://${id}.example/post`,
  })

  // A watched page in the same folder. It is a `feeds` row with `kind: 'page'`
  // now, so the cascade that handles feeds handles it — it used to be a
  // `scraped_feeds` row whose articles joined by URL string, needing its own
  // pass, and rows whose source had already gone were simply orphaned.
  await db.insert(feeds).values({
    id: `${id}-page`, name: 'p', url: `https://${id}-page.example/blog`,
    kind: 'page', folderId: id, workspaceId: WS,
  })
  await db.insert(articles).values({
    id: `${id}-page-article`, feedId: `${id}-page`, title: 't',
    link: `https://${id}-page.example/blog/post`,
  })
}

async function countAll(db: Database) {
  return {
    folders: (await db.select({ id: folders.id }).from(folders)).length,
    feeds: (await db.select({ id: feeds.id }).from(feeds)).length,
    articles: (await db.select({ id: articles.id }).from(articles)).length,
    folderShares: (await db.select({ id: folderShares.folderId }).from(folderShares)).length,
    feedShares: (await db.select({ id: feedShares.feedId }).from(feedShares)).length,
    watchedPages: (
      await db.select({ id: feeds.id }).from(feeds).where(eq(feeds.kind, 'page'))
    ).length,
  }
}

describe('deleteFolderTree', () => {
  it('leaves nothing behind for a single folder', async () => {
    const db = await freshDb()
    await seedFolder(db, 'solo')

    await deleteFolderTree(db, 'solo', WS)

    expect(await countAll(db)).toEqual({
      folders: 0, feeds: 0, articles: 0, folderShares: 0,
      feedShares: 0, watchedPages: 0,
    })
  })

  it('removes the whole subtree, not just the folder named', async () => {
    const db = await freshDb()
    await seedFolder(db, 'root')
    await seedFolder(db, 'child', { parentId: 'root' })
    await seedFolder(db, 'grandchild', { parentId: 'child' })

    await deleteFolderTree(db, 'root', WS)

    expect(await countAll(db)).toEqual({
      folders: 0, feeds: 0, articles: 0, folderShares: 0,
      feedShares: 0, watchedPages: 0,
    })
  })

  it('lets the same site be watched again afterwards', async () => {
    const db = await freshDb()
    await seedFolder(db, 'root')

    await deleteFolderTree(db, 'root', WS)

    // `scraped_feeds.site_url` was UNIQUE across the whole table, so one
    // orphaned row made a site permanently un-addable — by anybody, in any
    // workspace. `feeds.url` carries no such constraint.
    await expect(
      db.insert(feeds).values({
        id: 'again', name: 'p', url: 'https://root-page.example/blog',
        kind: 'page', folderId: null, workspaceId: WS,
      }),
    ).resolves.toBeDefined()
  })

  it('touches nothing outside the subtree', async () => {
    const db = await freshDb()
    await seedFolder(db, 'target')
    await seedFolder(db, 'bystander')

    await deleteFolderTree(db, 'target', WS)

    const left = await countAll(db)
    expect(left).toEqual({
      folders: 1, feeds: 2, articles: 2, folderShares: 1,
      feedShares: 1, watchedPages: 1,
    })
    const [survivor] = await db.select({ id: folders.id }).from(folders)
    expect(survivor.id).toBe('bystander')
  })

  it('does not follow parent_id into another workspace', async () => {
    const db = await freshDb()
    await seedFolder(db, 'root')
    await seedFolder(db, 'foreign', { parentId: 'root' })
    // Same parent, different tenant — must survive.
    await db.update(folders).set({ workspaceId: 'workspace-b' }).where(eq(folders.id, 'foreign'))

    await deleteFolderTree(db, 'root', WS)

    const remaining = await db.select({ id: folders.id }).from(folders)
    expect(remaining.map((f) => f.id)).toEqual(['foreign'])
  })

  it('terminates on a parent_id cycle', async () => {
    const db = await freshDb()
    await seedFolder(db, 'a')
    await seedFolder(db, 'b', { parentId: 'a' })
    // parent_id has no self-FK, so nothing at the database level stops this.
    await db.update(folders).set({ parentId: 'b' }).where(eq(folders.id, 'a'))

    const order = await collectFolderSubtree(db, 'a', WS)
    expect(order).toEqual(['b', 'a'])
  })

  it('deletes children before their parents', async () => {
    const db = await freshDb()
    await seedFolder(db, 'root')
    await seedFolder(db, 'child', { parentId: 'root' })

    expect(await collectFolderSubtree(db, 'root', WS)).toEqual(['child', 'root'])
  })
})
