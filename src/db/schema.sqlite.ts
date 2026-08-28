import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// ── Better Auth tables ────────────────────────────────────────
export * from './auth-schema'

// ── RSS app tables ────────────────────────────────────────────
export const folders = sqliteTable('folders', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    workspaceId: text('workspace_id'),
    parentId: text('parent_id'),
    createdAt: text('created_at').default(new Date().toISOString()),
})

export const folderShares = sqliteTable('folder_shares', {
    folderId: text('folder_id').primaryKey().references(() => folders.id),
    isShared: integer('is_shared').notNull().default(0),
    password: text('password'),
    createdAt: text('created_at').default(new Date().toISOString()),
})

export const feedShares = sqliteTable('feed_shares', {
  feedId: text('feed_id').primaryKey()
    .references(() => feeds.id),
  isShared: integer('is_shared').notNull().default(0),
  password: text('password'),
  createdAt: text('created_at').default(new Date().toISOString()),
})

export const feeds = sqliteTable('feeds', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    url: text('url').notNull(),
    folderId: text('folder_id').references(() => folders.id),
    workspaceId: text('workspace_id'),
    includeKeywords: text('include_keywords'),
    excludeKeywords: text('exclude_keywords'),
    createdAt: text('created_at').default(new Date().toISOString()),
    // Fetch health. Nothing recorded these before, so a feed that had started
    // 404ing was indistinguishable from a blog that simply had not posted.
    lastFetchedAt: text('last_fetched_at'),
    lastError: text('last_error'),
    lastErrorAt: text('last_error_at'),
})

export const articles = sqliteTable('articles', {
    id: text('id').primaryKey(),
    feedId: text('feed_id').references(() => feeds.id),
    title: text('title').notNull(),
    description: text('description'),
    content: text('content'),
    contentFetchedAt: text('content_fetched_at'),
    link: text('link').notNull(),
    image: text('image'),
    publishedAt: text('published_at'),
    isUsed: integer('is_used', { mode: 'boolean' }).default(false),
    visitCount: integer('visit_count').default(0),
    isBookmarked: integer('is_bookmarked', { mode: 'boolean' }).default(false),
    isReadLater: integer('is_read_later', { mode: 'boolean' }).default(false),
    isFavorite: integer('is_favorite', { mode: 'boolean' }).default(false),
    createdAt: text('created_at').default(new Date().toISOString()),
})

export const invites = sqliteTable('invites', {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    workspaceId: text('workspace_id'),
    role: text('role').notNull().default('member'),
    token: text('token').notNull().unique(),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    usedAt: integer('used_at', { mode: 'timestamp' }),
})

export const passwordResets = sqliteTable('password_resets', {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    token: text('token').notNull().unique(),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    usedAt: integer('used_at', { mode: 'timestamp' }),
})

export const billingRequests = sqliteTable('billing_requests', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    company: text('company').notNull(),
    message: text('message').notNull(),
    status: text('status').default('pending'),
    createdAt: text('created_at').default(new Date().toISOString()),
})

export const scrapedFeeds = sqliteTable('scraped_feeds', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspaceId: text('workspace_id'),
  folderId: text('folder_id'),
  siteUrl: text('site_url').notNull().unique(),
  title: text('title'),
  lastHash: text('last_hash'),
  lastFetchedAt: text('last_fetched_at'),
  lastError: text('last_error'),
  lastErrorAt: text('last_error_at'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

export const scrapedArticles = sqliteTable('scraped_articles', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspaceId: text('workspace_id'),
  folderId: text('folder_id'),
  siteUrl: text('site_url').notNull(),
  title: text('title').notNull(),
  url: text('url').notNull().unique(),
  date: text('date'),
  description: text('description'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})