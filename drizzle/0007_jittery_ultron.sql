-- These tables had no indexes at all. `articles.feed_id` is the important one:
-- article tenancy is only reachable via articles.feed_id -> feeds.workspace_id,
-- so every workspace-scoped article query was a full scan.
--
-- Plain CREATE INDEX takes a write lock for the duration. That is fine at
-- current row counts; if the articles table ever gets large, run these by hand
-- as CREATE INDEX CONCURRENTLY instead — drizzle cannot emit it, because
-- CONCURRENTLY cannot run inside the transaction the migrator wraps around each
-- file.
CREATE INDEX "articles_feed_idx" ON "articles" USING btree ("feed_id");--> statement-breakpoint
CREATE INDEX "articles_feed_unread_idx" ON "articles" USING btree ("feed_id","is_used");--> statement-breakpoint
CREATE INDEX "feeds_workspace_idx" ON "feeds" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "feeds_folder_idx" ON "feeds" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "folders_workspace_idx" ON "folders" USING btree ("workspace_id");