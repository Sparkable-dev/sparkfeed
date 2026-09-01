UPDATE "billing_requests" SET "status" = 'pending' WHERE "status" IS NULL;--> statement-breakpoint
UPDATE "member" SET "role" = 'editor' WHERE "role" = 'member';--> statement-breakpoint
UPDATE "invitation" SET "role" = 'editor' WHERE "role" = 'member' OR "role" IS NULL;--> statement-breakpoint
UPDATE "invites" SET "role" = 'editor' WHERE "role" = 'member';--> statement-breakpoint
ALTER TABLE "billing_requests" ALTER COLUMN "status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "member" ALTER COLUMN "role" SET DEFAULT 'editor';--> statement-breakpoint
ALTER TABLE "billing_requests" ADD COLUMN "requester_user_id" text;--> statement-breakpoint
ALTER TABLE "billing_requests" ADD COLUMN "request_type" text DEFAULT 'create_workspace' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_requests" ADD COLUMN "workspace_name" text;--> statement-breakpoint
ALTER TABLE "billing_requests" ADD COLUMN "expected_seats" integer;--> statement-breakpoint
ALTER TABLE "billing_requests" ADD COLUMN "requested_plan" text;--> statement-breakpoint
ALTER TABLE "billing_requests" ADD COLUMN "workspace_id" text;--> statement-breakpoint
ALTER TABLE "billing_requests" ADD COLUMN "decision_note" text;--> statement-breakpoint
ALTER TABLE "billing_requests" ADD COLUMN "updated_at" text;--> statement-breakpoint
UPDATE "billing_requests" SET "updated_at" = COALESCE("created_at", CURRENT_TIMESTAMP::text);--> statement-breakpoint
ALTER TABLE "billing_requests" ADD CONSTRAINT "billing_requests_requester_user_id_user_id_fk" FOREIGN KEY ("requester_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_requests_requester_idx" ON "billing_requests" USING btree ("requester_user_id","status");--> statement-breakpoint
CREATE INDEX "billing_requests_workspace_idx" ON "billing_requests" USING btree ("workspace_id");
