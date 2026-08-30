ALTER TABLE "credit_ledger" ADD COLUMN "credit_bucket" text;--> statement-breakpoint
UPDATE "credit_ledger"
SET "credit_bucket" = CASE
	WHEN "reason" = 'cloud_free_verified_account' THEN 'free'
	ELSE 'paid'
END
WHERE "credit_bucket" IS NULL;--> statement-breakpoint
ALTER TABLE "credit_ledger" ALTER COLUMN "credit_bucket" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "feeds" ADD COLUMN "entitlement_paused_at" text;--> statement-breakpoint
ALTER TABLE "workspace_subscriptions" ADD COLUMN "paid_credit_retention_ends_at" text;--> statement-breakpoint
ALTER TABLE "workspace_subscriptions" ADD COLUMN "provider_event_at" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "dodo_customer_id" text;
