CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"created_by_user_id" text,
	"name" text NOT NULL,
	"hash" text NOT NULL,
	"prefix" text NOT NULL,
	"scopes" text NOT NULL,
	"last_used_at" text,
	"expires_at" text,
	"revoked_at" text,
	"created_at" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash_idx" ON "api_keys" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "api_keys_workspace_idx" ON "api_keys" USING btree ("workspace_id");