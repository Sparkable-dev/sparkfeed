import { eq, inArray } from "drizzle-orm"
import { fetchAndInsertArticles } from "./utils/fetch-articles"
import { db } from "@/db/index"
import { articles, feeds, folders } from "@/db/schema"
import { DEMO_WORKSPACE_ID } from "@/lib/demo"
import demoConfig from "@/config/demo-feeds.json"

export { DEMO_WORKSPACE_ID }

let schemaReady = false
export async function ensureDemoSchema(): Promise<void> {
  if (schemaReady) return
  schemaReady = true

  const { createClient } = await import('@libsql/client')
  const client = createClient({ url: 'file:rss-demo.db' })

  const tables = [
    `CREATE TABLE IF NOT EXISTS folders (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      workspace_id text,
      parent_id text,
      position integer,
      created_at text
    )`,
    `CREATE TABLE IF NOT EXISTS folder_shares (
      folder_id text PRIMARY KEY NOT NULL REFERENCES folders(id),
      is_shared integer NOT NULL DEFAULT 0,
      password text,
      created_at text
    )`,
    `CREATE TABLE IF NOT EXISTS feeds (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      url text NOT NULL,
      folder_id text REFERENCES folders(id),
      workspace_id text,
      kind text NOT NULL DEFAULT 'rss',
      include_keywords text,
      exclude_keywords text,
      position integer,
      created_at text,
      last_fetched_at text,
      last_error text,
      last_error_at text
    )`,
    `CREATE TABLE IF NOT EXISTS feed_shares (
      feed_id text PRIMARY KEY NOT NULL REFERENCES feeds(id),
      is_shared integer NOT NULL DEFAULT 0,
      password text,
      created_at text
    )`,
    `CREATE TABLE IF NOT EXISTS articles (
      id text PRIMARY KEY NOT NULL,
      feed_id text REFERENCES feeds(id),
      title text NOT NULL,
      description text,
      content text,
      content_fetched_at text,
      link text NOT NULL,
      image text,
      published_at text,
      is_used integer DEFAULT 0,
      visit_count integer DEFAULT 0,
      is_bookmarked integer DEFAULT 0,
      is_read_later integer DEFAULT 0,
      is_favorite integer DEFAULT 0,
      created_at text
    )`,
    `CREATE TABLE IF NOT EXISTS invites (
      id text PRIMARY KEY NOT NULL,
      email text NOT NULL,
      workspace_id text,
      role text NOT NULL DEFAULT 'member',
      token text NOT NULL UNIQUE,
      expires_at integer NOT NULL,
      used_at integer
    )`,
    `CREATE TABLE IF NOT EXISTS password_resets (
      id text PRIMARY KEY NOT NULL,
      email text NOT NULL,
      token text NOT NULL UNIQUE,
      expires_at integer NOT NULL,
      used_at integer
    )`,
    `CREATE TABLE IF NOT EXISTS billing_requests (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      email text NOT NULL,
      company text NOT NULL,
      message text NOT NULL,
      status text DEFAULT 'pending',
      created_at text
    )`,
    `CREATE TABLE IF NOT EXISTS scraped_feeds (
      id text PRIMARY KEY NOT NULL,
      workspace_id text,
      folder_id text,
      site_url text NOT NULL UNIQUE,
      title text,
      last_hash text,
      created_at integer,
      last_fetched_at text,
      last_error text,
      last_error_at text
    )`,
    `CREATE TABLE IF NOT EXISTS scraped_articles (
      id text PRIMARY KEY NOT NULL,
      workspace_id text,
      folder_id text,
      site_url text NOT NULL,
      title text NOT NULL,
      url text NOT NULL UNIQUE,
      date text,
      description text,
      created_at integer
    )`,
    // Defined in schema.pg.ts but never added here, so demo mode has had no
    // api_keys table at all. Same class of bug as the catalogue tables below:
    // this list is hand-maintained and does not follow the Drizzle schema.
    `CREATE TABLE IF NOT EXISTS api_keys (
      id text PRIMARY KEY NOT NULL,
      workspace_id text NOT NULL,
      created_by_user_id text,
      name text NOT NULL,
      hash text NOT NULL,
      prefix text NOT NULL,
      scopes text NOT NULL,
      last_used_at text,
      expires_at text,
      revoked_at text,
      created_at text
    )`,
    `CREATE TABLE IF NOT EXISTS catalogue_collections (
      slug text PRIMARY KEY NOT NULL,
      category text NOT NULL,
      name text NOT NULL,
      description text NOT NULL,
      site_url text,
      cover_file text,
      accent text,
      sort_order integer NOT NULL DEFAULT 0,
      import_count integer NOT NULL DEFAULT 0,
      retired_at text,
      created_at text
    )`,
    `CREATE TABLE IF NOT EXISTS catalogue_feeds (
      slug text PRIMARY KEY NOT NULL,
      category text NOT NULL,
      collection_slug text,
      name text NOT NULL,
      description text NOT NULL,
      feed_url text NOT NULL,
      site_url text,
      icon_file text,
      accent text,
      sort_order integer NOT NULL DEFAULT 0,
      status text NOT NULL DEFAULT 'unknown',
      failure_streak integer NOT NULL DEFAULT 0,
      last_checked_at text,
      last_error text,
      article_count integer,
      latest_title text,
      latest_published_at text,
      articles_fetched_at text,
      articles_error text,
      import_count integer NOT NULL DEFAULT 0,
      retired_at text,
      created_at text
    )`,
    `CREATE TABLE IF NOT EXISTS catalogue_articles (
      feed_slug text NOT NULL,
      link text NOT NULL,
      title text NOT NULL,
      description text,
      image text,
      published_at text,
      sort_order integer NOT NULL DEFAULT 0,
      fetched_at text,
      PRIMARY KEY (feed_slug, link)
    )`,
    /*
      Chat history. Created even though demo mode refuses to reach a model, so
      the sidebar's history query returns an empty list rather than failing on a
      missing table — a broken sidebar would be far more visible than the
      feature it belongs to.
    */
    `CREATE TABLE IF NOT EXISTS chat_threads (
      id text PRIMARY KEY,
      workspace_id text,
      user_id text NOT NULL,
      title text NOT NULL,
      created_at text,
      updated_at text,
      archived_at text
    )`,
    `CREATE TABLE IF NOT EXISTS chat_messages (
      id text PRIMARY KEY,
      thread_id text NOT NULL,
      seq integer NOT NULL,
      role text NOT NULL,
      parts text NOT NULL,
      search_text text NOT NULL DEFAULT '',
      created_at text
    )`,
  ]

  for (const sql of tables) {
    await client.execute(sql)
  }

  // Additive migrations for pre-existing demo DBs (CREATE TABLE IF NOT EXISTS
  // above won't alter a table that already exists). Ignore duplicate-column errors.
  const migrations = [
    `ALTER TABLE articles ADD COLUMN content text`,
    `ALTER TABLE articles ADD COLUMN content_fetched_at text`,
    `ALTER TABLE feeds ADD COLUMN kind text NOT NULL DEFAULT 'rss'`,
    `ALTER TABLE feeds ADD COLUMN last_fetched_at text`,
    `ALTER TABLE feeds ADD COLUMN last_error text`,
    `ALTER TABLE feeds ADD COLUMN last_error_at text`,
    `ALTER TABLE scraped_feeds ADD COLUMN last_fetched_at text`,
    `ALTER TABLE scraped_feeds ADD COLUMN last_error text`,
    `ALTER TABLE scraped_feeds ADD COLUMN last_error_at text`,
    `ALTER TABLE catalogue_feeds ADD COLUMN articles_fetched_at text`,
    `ALTER TABLE catalogue_feeds ADD COLUMN articles_error text`,
    /*
      Manual ordering. Mandatory here even though demo mode can never reorder:
      drizzle expands `db.select()` into an explicit column list from the TS
      schema, and `refreshAllFeeds` (which is deliberately *not* demo-locked and
      sits behind the refresh button) does exactly that on `feeds`. Without this
      an existing rss-demo.db throws "no such column: feeds.position" the moment
      the new bundle boots.
    */
    `ALTER TABLE folders ADD COLUMN position integer`,
    `ALTER TABLE feeds ADD COLUMN position integer`,
  ]
  for (const sql of migrations) {
    try {
      await client.execute(sql)
    } catch {
      // Column already exists — safe to ignore.
    }
  }

  await client.close()
}

// Idempotent — safe to call on every request. Returns immediately if already seeded.
export async function seedDemoData(): Promise<void> {

  const existing = await db
    .select({ id: folders.id })
    .from(folders)
    .where(eq(folders.workspaceId, DEMO_WORKSPACE_ID))
    .limit(1)

  if (existing.length > 0) return

  console.log("[demo] Seeding demo workspace...")

  // Insert folders
  for (const folder of demoConfig.folders) {
    await db.insert(folders).values({
      id: folder.id,
      name: folder.name,
      workspaceId: DEMO_WORKSPACE_ID,
    }).onConflictDoNothing()
  }

  // Insert feeds
  const allFeeds = demoConfig.folders.flatMap(folder =>
    folder.feeds.map(feed => ({ ...feed, folderId: folder.id }))
  )

  for (const feed of allFeeds) {
    await db.insert(feeds).values({
      id: feed.id,
      name: feed.name,
      url: feed.url,
      folderId: feed.folderId,
      workspaceId: DEMO_WORKSPACE_ID,
      includeKeywords: "[]",
      excludeKeywords: "[]",
    }).onConflictDoNothing()
  }

  // Fetch articles for all feeds — failures are isolated and logged
  const results = await Promise.allSettled(
    allFeeds.map(feed => fetchAndInsertArticles(feed.id, feed.url))
  )

  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      console.log(`[demo] ${allFeeds[i].name}: ${result.value} articles inserted`)
    } else {
      console.warn(`[demo] ${allFeeds[i].name}: fetch failed —`, result.reason?.message ?? result.reason)
    }
  })

  // Pre-seed favorites — pick the top article from one feed per folder so the
  // favorites page is populated even before the user interacts with anything.
  const favFeedIds = ["demo-feed-openai", "demo-feed-aws", "demo-feed-hubspot"]
  const favArticles = await Promise.all(
    favFeedIds.map(feedId =>
      db.select({ id: articles.id })
        .from(articles)
        .where(eq(articles.feedId, feedId))
        .limit(1)
    )
  )
  const favIds = favArticles.flat().map(a => a.id).filter(Boolean)
  if (favIds.length > 0) {
    await db.update(articles).set({ isFavorite: true }).where(inArray(articles.id, favIds))
    console.log(`[demo] Pre-seeded ${favIds.length} favorites`)
  }

  console.log("[demo] Seeding complete.")
}
