ALTER TABLE "articles" ADD COLUMN "source_id" text;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "source_updated_at" text;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "content_source" text;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "content_error_at" text;--> statement-breakpoint
ALTER TABLE "catalogue_feeds" ADD COLUMN "source_kind" text DEFAULT 'rss' NOT NULL;--> statement-breakpoint
ALTER TABLE "feeds" ADD COLUMN "http_etag" text;--> statement-breakpoint
ALTER TABLE "feeds" ADD COLUMN "http_last_modified" text;--> statement-breakpoint
CREATE UNIQUE INDEX "articles_feed_source_id_idx" ON "articles" USING btree ("feed_id","source_id");