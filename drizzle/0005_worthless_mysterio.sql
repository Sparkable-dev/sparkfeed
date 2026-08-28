CREATE TABLE "catalogue_articles" (
	"feed_slug" text NOT NULL,
	"link" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"image" text,
	"published_at" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"fetched_at" text,
	CONSTRAINT "catalogue_articles_feed_slug_link_pk" PRIMARY KEY("feed_slug","link")
);
--> statement-breakpoint
ALTER TABLE "catalogue_feeds" ADD COLUMN "articles_fetched_at" text;--> statement-breakpoint
ALTER TABLE "catalogue_feeds" ADD COLUMN "articles_error" text;--> statement-breakpoint
CREATE INDEX "catalogue_articles_feed_idx" ON "catalogue_articles" USING btree ("feed_slug");