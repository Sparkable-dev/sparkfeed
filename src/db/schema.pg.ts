import { boolean, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

export * from './auth-schema.pg'

export const folders = pgTable('folders', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  workspaceId: text('workspace_id'),
  parentId: text('parent_id'),
  /**
   * Manual order within the workspace, ascending, dense from 0. Written only by
   * `saveSourceOrder`, which rewrites a whole group at a time.
   *
   * Nullable, and null is the meaningful state: it means "never dragged". Null
   * rows sort after every positioned one, by `createdAt` — which is exactly the
   * order this app had before ordering existed. So nothing moves for anyone
   * until they move it themselves, and a feed added later lands at the bottom
   * of its group rather than at some arbitrary index. That is also why there is
   * no backfill migration.
   *
   * Ordering must go through `FOLDER_ORDER` / `FEED_ORDER` in
   * `@/server/services/ordering` — a bare `ORDER BY position` sorts nulls first
   * on SQLite and last on Postgres, and demo mode runs these Postgres table
   * objects against SQLite.
   */
  position: integer('position'),
  createdAt: text('created_at').$defaultFn(() => new Date().toISOString()),
}, (t) => [
  index('folders_workspace_idx').on(t.workspaceId),
])

export const folderShares = pgTable('folder_shares', {
  folderId: text('folder_id')
    .primaryKey()
    .references(() => folders.id),
  isShared: boolean('is_shared').notNull().default(false),
  password: text('password'),
  createdAt: text('created_at').$defaultFn(() => new Date().toISOString()),
})

export const feeds = pgTable('feeds', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  folderId: text('folder_id').references(() => folders.id),
  workspaceId: text('workspace_id'),
  /**
   * How this source is read: `rss` for a real feed, `page` for a site with no
   * feed whose listing page we parse instead.
   *
   * A column rather than a second table, which is the point of the change.
   * Watched pages used to live in `scraped_feeds` / `scraped_articles` — a
   * parallel id space nothing rendered, so a watched source was invisible in
   * the sidebar, on /sources, in search, in the reader and in every AI tool.
   * As a feed row all of that works unchanged and only ingestion has to know
   * the difference.
   */
  kind: text('kind').notNull().default('rss'),
  includeKeywords: text('include_keywords'),
  excludeKeywords: text('exclude_keywords'),
  /** Order within `folder_id`; a null folder is the Ungrouped bucket. See `folders.position`. */
  position: integer('position'),
  createdAt: text('created_at').$defaultFn(() => new Date().toISOString()),
  // Fetch health. Nothing recorded these before, so a feed that had started
  // 404ing was indistinguishable from a blog that simply had not posted.
  lastFetchedAt: text('last_fetched_at'),
  lastError: text('last_error'),
  lastErrorAt: text('last_error_at'),
}, (t) => [
  index('feeds_workspace_idx').on(t.workspaceId),
  index('feeds_folder_idx').on(t.folderId),
])

export const feedShares = pgTable('feed_shares', {
  feedId: text('feed_id')
    .primaryKey()
    .references(() => feeds.id),
  isShared: boolean('is_shared').notNull().default(false),
  password: text('password'),
  createdAt: text('created_at').$defaultFn(() => new Date().toISOString()),
})

export const articles = pgTable('articles', {
  id: text('id').primaryKey(),
  feedId: text('feed_id').references(() => feeds.id),
  title: text('title').notNull(),
  description: text('description'),
  content: text('content'),
  contentFetchedAt: text('content_fetched_at'),
  link: text('link').notNull(),
  image: text('image'),
  publishedAt: text('published_at'),
  isUsed: boolean('is_used').default(false),
  visitCount: integer('visit_count').default(0),
  isBookmarked: boolean('is_bookmarked').default(false),
  isReadLater: boolean('is_read_later').default(false),
  isFavorite: boolean('is_favorite').default(false),
  createdAt: text('created_at').$defaultFn(() => new Date().toISOString()),
}, (t) => [
  // `articles` had no indexes at all, including on `feed_id` — which every
  // tenancy check goes through, since ownership is only reachable via
  // `articles.feed_id -> feeds.workspace_id` (see `articleInWorkspace`). Every
  // workspace-scoped article query was therefore a full table scan, which the
  // stats tool turns from a background cost into a per-question one.
  index('articles_feed_idx').on(t.feedId),
  // Unread counts group by feed and filter on is_used; the composite serves
  // both without a second lookup.
  index('articles_feed_unread_idx').on(t.feedId, t.isUsed),
])

export const invites = pgTable('invites', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  workspaceId: text('workspace_id'),
  role: text('role').notNull().default('member'),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
})

export const passwordResets = pgTable('password_resets', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
})

export const billingRequests = pgTable('billing_requests', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  company: text('company').notNull(),
  message: text('message').notNull(),
  status: text('status').default('pending'),
  createdAt: text('created_at').$defaultFn(() => new Date().toISOString()),
})

/**
 * API keys for the MCP server and, later, the public REST API.
 *
 * Hand-rolled rather than better-auth's `apiKey` plugin because that plugin
 * scopes a key to a `userId`, while this app's tenancy anchor is
 * `activeOrganizationId || user.id`. A key has to pin a *workspace*, and
 * re-deriving that from key metadata would fork the tenancy rule.
 *
 * Only `hash` is stored. The raw key is shown once at mint time and is
 * unrecoverable afterwards; `prefix` exists so the UI can identify a key in a
 * list without holding the secret.
 */
export const apiKeys = pgTable('api_keys', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  createdByUserId: text('created_by_user_id'),
  name: text('name').notNull(),
  /** sha256 of the raw key, hex. Looked up on every authenticated request. */
  hash: text('hash').notNull(),
  /** First few characters of the raw key, for display only (`sfk_live_ab12…`). */
  prefix: text('prefix').notNull(),
  /** JSON array of scope strings. See src/server/api/scopes.ts. */
  scopes: text('scopes').notNull(),
  lastUsedAt: text('last_used_at'),
  expiresAt: text('expires_at'),
  revokedAt: text('revoked_at'),
  createdAt: text('created_at').$defaultFn(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex('api_keys_hash_idx').on(table.hash),
  index('api_keys_workspace_idx').on(table.workspaceId),
])

export const scrapedFeeds = pgTable('scraped_feeds', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  workspaceId: text('workspace_id'),
  folderId: text('folder_id'),
  siteUrl: text('site_url').notNull().unique(),
  title: text('title'),
  lastHash: text('last_hash'),
  lastFetchedAt: text('last_fetched_at'),
  lastError: text('last_error'),
  lastErrorAt: text('last_error_at'),
  createdAt: timestamp('created_at').$defaultFn(() => new Date()),
})

export const scrapedArticles = pgTable('scraped_articles', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  workspaceId: text('workspace_id'),
  folderId: text('folder_id'),
  siteUrl: text('site_url').notNull(),
  title: text('title').notNull(),
  url: text('url').notNull().unique(),
  date: text('date'),
  description: text('description'),
  createdAt: timestamp('created_at').$defaultFn(() => new Date()),
})

// ─────────────────────────────────────────────
// DISCOVER CATALOGUE
// ─────────────────────────────────────────────

/**
 * The curated catalogue behind the Discover page.
 *
 * These two tables are a **materialised copy** of `src/config/catalogue.json`,
 * which is the source of truth. Curation is reviewed in a diff and ships with
 * the repo, so a self-hosted install has a populated Discover page with no
 * seeding step; the tables exist to cache the half that a file cannot hold —
 * whether a feed is still alive, how many articles it carries, its latest
 * headline, how many people imported it.
 *
 * **Curated columns are overwritten on every sync. Cached columns must never
 * appear in the sync's `set` clause** — if they do, each deploy silently wipes
 * the numbers and the page reads as dead until the next refresh.
 *
 * Timestamps are ISO strings rather than `timestamp`, and there are no
 * dialect-specific defaults, because demo mode runs these same Postgres
 * definitions against SQLite through the cast in `db/client.ts`.
 */
export const catalogueCollections = pgTable('catalogue_collections', {
  /** Stable, hand-authored, e.g. "ai-openai". Also the upsert key. */
  slug: text('slug').primaryKey(),
  category: text('category').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  siteUrl: text('site_url'),
  /** Filename under public/catalogue/, not a URL. */
  coverFile: text('cover_file'),
  /** Brand colour, overrides the hashed gradient when set. */
  accent: text('accent'),
  sortOrder: integer('sort_order').notNull().default(0),
  // ── cached; never written by the JSON sync ──
  importCount: integer('import_count').notNull().default(0),
  /**
   * Set when a slug disappears from the JSON. Soft delete, so pulling a source
   * from curation does not destroy its counters, and rows already imported into
   * users' workspaces are untouched either way.
   */
  retiredAt: text('retired_at'),
  createdAt: text('created_at').$defaultFn(() => new Date().toISOString()),
}, (t) => [
  index('catalogue_collections_category_idx').on(t.category),
])

export const catalogueFeeds = pgTable('catalogue_feeds', {
  slug: text('slug').primaryKey(),
  category: text('category').notNull(),
  /**
   * Set when this feed belongs to a collection. Membership is a column rather
   * than a join table, and deliberately has no foreign key: a reference would
   * make sync order significant and let one bad edit fail the whole upsert.
   */
  collectionSlug: text('collection_slug'),
  name: text('name').notNull(),
  description: text('description').notNull(),
  /** Resolved by scripts/catalogue-validate.ts, never hand-typed. */
  feedUrl: text('feed_url').notNull(),
  siteUrl: text('site_url'),
  iconFile: text('icon_file'),
  accent: text('accent'),
  sortOrder: integer('sort_order').notNull().default(0),
  // ── cached; never written by the JSON sync ──
  /** 'ok' | 'dead' | 'unknown'. Two consecutive failures before 'dead'. */
  status: text('status').notNull().default('unknown'),
  /** Consecutive probe failures. Reset to 0 on success. */
  failureStreak: integer('failure_streak').notNull().default(0),
  lastCheckedAt: text('last_checked_at'),
  lastError: text('last_error'),
  articleCount: integer('article_count'),
  latestTitle: text('latest_title'),
  latestPublishedAt: text('latest_published_at'),
  /**
   * When the Discover preview last tried this feed, successful or not.
   *
   * Stamped even on failure, on purpose: if it only advanced on success, a feed
   * that 403s would be refetched on every single card open forever — the TTL
   * would disengage for exactly the feeds that cost the most.
   *
   * Separate from `lastCheckedAt`/`status`/`failureStreak` because those belong
   * to the validator. A preview must never be able to mark a feed dead: the
   * catalogue read filters on `status`, so one network blip during one user's
   * dialog would delete that card from Discover for everybody.
   */
  articlesFetchedAt: text('articles_fetched_at'),
  articlesError: text('articles_error'),
  importCount: integer('import_count').notNull().default(0),
  retiredAt: text('retired_at'),
  createdAt: text('created_at').$defaultFn(() => new Date().toISOString()),
}, (t) => [
  index('catalogue_feeds_category_idx').on(t.category),
  index('catalogue_feeds_collection_idx').on(t.collectionSlug),
])

/**
 * Recent articles for catalogue feeds, so a Discover card can be looked inside
 * before it is added.
 *
 * Entirely a cache, and shared by every user — the catalogue is the same page
 * for everyone, so this is deliberately not workspace-scoped. Nothing here is
 * authored; it can be truncated at any time and will refill on the next view.
 *
 * Refresh is delete-then-insert per feed rather than an upsert. A dozen rows
 * makes the write trivial either way, and replacing means items a feed has
 * dropped cannot linger, `sortOrder` stays honest as the position in *this*
 * fetch, and there is no `onConflict` target to get wrong across the
 * Postgres/SQLite cast.
 *
 * No foreign key on `feedSlug`, for the same reason `catalogueFeeds` has none
 * on its collection.
 */
export const catalogueArticles = pgTable('catalogue_articles', {
  feedSlug: text('feed_slug').notNull(),
  link: text('link').notNull(),
  title: text('title').notNull(),
  /** Truncated on write — feeds routinely put an entire post in the summary. */
  description: text('description'),
  /** Only what the feed itself provided; the preview never scrapes og:image. */
  image: text('image'),
  publishedAt: text('published_at'),
  sortOrder: integer('sort_order').notNull().default(0),
  fetchedAt: text('fetched_at'),
}, (t) => [
  primaryKey({ columns: [t.feedSlug, t.link] }),
  index('catalogue_articles_feed_idx').on(t.feedSlug),
])

/**
 * A saved Spark AI conversation.
 *
 * Scoped to a **user** as well as a workspace, unlike every other table here. A
 * chat is half-formed thinking out loud, and a workspace-scoped one would be
 * visible to every colleague the moment it was typed. Sharing is a later,
 * explicit action; history that was public by default cannot be un-shared.
 *
 * `workspaceId` is still carried because a chat is *about* a workspace — its
 * tool calls reference that workspace's feed and article ids, so replaying it
 * against a different one would show rows that no longer mean anything.
 */
export const chatThreads = pgTable('chat_threads', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id'),
  userId: text('user_id').notNull(),
  /** Derived from the first user message; editable. Never null, so the list has nothing to fall back to. */
  title: text('title').notNull(),
  createdAt: text('created_at').$defaultFn(() => new Date().toISOString()),
  /** Bumped on every save, and what the list sorts by — not `createdAt`, or a chat you returned to yesterday sinks. */
  updatedAt: text('updated_at').$defaultFn(() => new Date().toISOString()),
  archivedAt: text('archived_at'),
}, (t) => [
  index('chat_threads_owner_idx').on(t.userId, t.workspaceId),
  index('chat_threads_updated_idx').on(t.updatedAt),
])

/**
 * One row per message, storing the AI SDK's `UIMessage` parts verbatim.
 *
 * `parts` is the whole point. It is the display format, not the model format —
 * it carries tool calls with their arguments and results, reasoning blocks, and
 * text, which is what lets a reloaded conversation look identical to a live
 * one. **Artifacts survive for free because of this**: `create_artifact` puts
 * the document in its tool call's arguments, so a stored part is a stored
 * document, and the card re-renders from it with no separate artifacts table.
 *
 * JSON in a `text` column rather than `jsonb`: demo mode runs these Postgres
 * table objects against SQLite, which has no jsonb type, and nothing here is
 * ever queried *into* — a thread is always read whole.
 *
 * `seq` rather than ordering by `createdAt`: two messages written in the same
 * millisecond are common at the end of a stream, and a tie there would reorder
 * the conversation.
 */
export const chatMessages = pgTable('chat_messages', {
  id: text('id').primaryKey(),
  threadId: text('thread_id').notNull().references(() => chatThreads.id),
  seq: integer('seq').notNull(),
  role: text('role').notNull(),
  parts: text('parts').notNull(),
  /** Plain text of the message, for the history search. Empty for a turn that was only tool calls. */
  searchText: text('search_text').notNull().default(''),
  createdAt: text('created_at').$defaultFn(() => new Date().toISOString()),
}, (t) => [
  index('chat_messages_thread_idx').on(t.threadId, t.seq),
])
