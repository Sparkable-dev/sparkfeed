ALTER TABLE "team_billing_state" ADD COLUMN "upgrade_user_id" text;--> statement-breakpoint
ALTER TABLE "team_billing_state" ADD COLUMN "personal_subscription_id" text;--> statement-breakpoint
ALTER TABLE "team_billing_state" ADD COLUMN "personal_renewal_stopped_at" text;--> statement-breakpoint
ALTER TABLE "team_billing_state" ADD COLUMN "content_moved_at" text;--> statement-breakpoint
ALTER TABLE "team_billing_state" ADD COLUMN "provider_status" text;--> statement-breakpoint
ALTER TABLE "team_billing_state" ADD CONSTRAINT "team_billing_state_upgrade_user_id_user_id_fk" FOREIGN KEY ("upgrade_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_billing_state" ADD CONSTRAINT "team_billing_state_upgrade_user_id_unique" UNIQUE("upgrade_user_id");