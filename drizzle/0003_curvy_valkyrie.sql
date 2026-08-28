ALTER TABLE "feeds" ADD COLUMN "last_fetched_at" text;--> statement-breakpoint
ALTER TABLE "feeds" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "feeds" ADD COLUMN "last_error_at" text;--> statement-breakpoint
ALTER TABLE "scraped_feeds" ADD COLUMN "last_fetched_at" text;--> statement-breakpoint
ALTER TABLE "scraped_feeds" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "scraped_feeds" ADD COLUMN "last_error_at" text;