ALTER TABLE "feeds" ADD COLUMN "kind" text DEFAULT 'rss' NOT NULL;--> statement-breakpoint

-- Watched pages become ordinary sources.
--
-- They used to live in `scraped_feeds` / `scraped_articles`, a parallel id
-- space that no part of the app rendered, so a watched site was invisible
-- everywhere except one folder-management dialog. Moving the rows into `feeds`
-- and `articles` is what makes them appear in the sidebar, on /sources, in
-- search and in the reader — the ingestion code is the only thing that still
-- needs to know the difference.
--
-- The old tables are left in place and untouched. Nothing reads them after
-- this, but dropping data in the same release that moves it leaves no way back
-- if the copy is wrong.
INSERT INTO "feeds" (
  "id", "name", "url", "folder_id", "workspace_id", "kind",
  "include_keywords", "exclude_keywords",
  "created_at", "last_fetched_at", "last_error", "last_error_at"
)
SELECT
  sf."id",
  COALESCE(NULLIF(TRIM(sf."title"), ''), sf."site_url"),
  sf."site_url",
  -- `scraped_feeds.folder_id` carried no foreign key, so it can name a folder
  -- that has since been deleted. `feeds.folder_id` does have one, and an
  -- orphan here would fail the whole migration.
  (SELECT fo."id" FROM "folders" fo WHERE fo."id" = sf."folder_id"),
  sf."workspace_id",
  'page',
  '[]',
  '[]',
  -- `scraped_feeds.created_at` is a bare `timestamp` while `feeds.created_at`
  -- is ISO text. Formatted directly rather than through `AT TIME ZONE`, which
  -- would reinterpret the value against whatever the session's timezone is.
  COALESCE(
    to_char(sf."created_at", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ),
  sf."last_fetched_at",
  sf."last_error",
  sf."last_error_at"
FROM "scraped_feeds" sf
WHERE NOT EXISTS (SELECT 1 FROM "feeds" f WHERE f."id" = sf."id");--> statement-breakpoint

INSERT INTO "articles" ("id", "feed_id", "title", "description", "link", "published_at", "created_at")
SELECT
  sa."id",
  sf."id",
  sa."title",
  sa."description",
  sa."url",
  -- The old scraper stored whatever a `<time>` element said, including display
  -- text like "3 days ago". Only a date that starts like an ISO one is carried
  -- over; the rest sort by when we first saw them, which is what they did
  -- before anyway.
  CASE WHEN sa."date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN sa."date" ELSE NULL END,
  COALESCE(
    to_char(sa."created_at", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )
FROM "scraped_articles" sa
JOIN "scraped_feeds" sf ON sf."site_url" = sa."site_url"
WHERE NOT EXISTS (SELECT 1 FROM "articles" a WHERE a."id" = sa."id");
