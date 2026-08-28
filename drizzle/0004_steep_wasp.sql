CREATE TABLE "catalogue_collections" (
	"slug" text PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"site_url" text,
	"cover_file" text,
	"accent" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"import_count" integer DEFAULT 0 NOT NULL,
	"retired_at" text,
	"created_at" text
);
--> statement-breakpoint
CREATE TABLE "catalogue_feeds" (
	"slug" text PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"collection_slug" text,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"feed_url" text NOT NULL,
	"site_url" text,
	"icon_file" text,
	"accent" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'unknown' NOT NULL,
	"failure_streak" integer DEFAULT 0 NOT NULL,
	"last_checked_at" text,
	"last_error" text,
	"article_count" integer,
	"latest_title" text,
	"latest_published_at" text,
	"import_count" integer DEFAULT 0 NOT NULL,
	"retired_at" text,
	"created_at" text
);
--> statement-breakpoint
CREATE INDEX "catalogue_collections_category_idx" ON "catalogue_collections" USING btree ("category");--> statement-breakpoint
CREATE INDEX "catalogue_feeds_category_idx" ON "catalogue_feeds" USING btree ("category");--> statement-breakpoint
CREATE INDEX "catalogue_feeds_collection_idx" ON "catalogue_feeds" USING btree ("collection_slug");