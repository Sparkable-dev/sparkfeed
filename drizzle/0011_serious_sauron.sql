CREATE TABLE "credit_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_type" text NOT NULL,
	"workspace_id" text NOT NULL,
	"beneficiary_user_id" text,
	"amount" integer NOT NULL,
	"entry_type" text NOT NULL,
	"grant_period" text,
	"ai_request_id" text,
	"reason" text,
	"actor_user_id" text,
	"idempotency_key" text NOT NULL,
	"expires_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dodo_webhook_inbox" (
	"webhook_id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"event_time" text NOT NULL,
	"payload_hash" text NOT NULL,
	"processing_status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"received_at" text NOT NULL,
	"processing_started_at" text,
	"processed_at" text
);
--> statement-breakpoint
CREATE TABLE "platform_admin_audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_user_id" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"reason" text NOT NULL,
	"before_state" text,
	"after_state" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_counters" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_type" text NOT NULL,
	"workspace_id" text NOT NULL,
	"beneficiary_user_id" text DEFAULT '' NOT NULL,
	"metric" text NOT NULL,
	"period_start" text NOT NULL,
	"period_end" text NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_subscriptions" (
	"workspace_type" text NOT NULL,
	"workspace_id" text NOT NULL,
	"plan_key" text NOT NULL,
	"billing_source" text NOT NULL,
	"subscription_status" text NOT NULL,
	"access_state" text NOT NULL,
	"billing_interval" text,
	"paid_seat_quantity" integer DEFAULT 1 NOT NULL,
	"scheduled_seat_quantity" integer,
	"scheduled_seat_effective_at" text,
	"current_period_start" text,
	"current_period_end" text,
	"failed_payment_grace_deadline" text,
	"dodo_customer_id" text,
	"dodo_subscription_id" text,
	"product_key" text,
	"override_seat_limit" integer,
	"override_monthly_ai_credits" integer,
	"override_source_unit_limit" integer,
	"override_api_access" boolean,
	"override_mcp_access" boolean,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "workspace_subscriptions_workspace_type_workspace_id_pk" PRIMARY KEY("workspace_type","workspace_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_idempotency_uidx" ON "credit_ledger" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "credit_ledger_balance_idx" ON "credit_ledger" USING btree ("workspace_type","workspace_id","beneficiary_user_id");--> statement-breakpoint
CREATE INDEX "credit_ledger_request_idx" ON "credit_ledger" USING btree ("ai_request_id");--> statement-breakpoint
CREATE INDEX "dodo_webhook_inbox_status_idx" ON "dodo_webhook_inbox" USING btree ("processing_status","event_time");--> statement-breakpoint
CREATE INDEX "platform_admin_audit_actor_idx" ON "platform_admin_audit_log" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "platform_admin_audit_target_idx" ON "platform_admin_audit_log" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_counters_period_uidx" ON "usage_counters" USING btree ("workspace_type","workspace_id","beneficiary_user_id","metric","period_start");--> statement-breakpoint
CREATE INDEX "usage_counters_workspace_idx" ON "usage_counters" USING btree ("workspace_type","workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_subscriptions_dodo_customer_uidx" ON "workspace_subscriptions" USING btree ("dodo_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_subscriptions_dodo_subscription_uidx" ON "workspace_subscriptions" USING btree ("dodo_subscription_id");--> statement-breakpoint
CREATE INDEX "workspace_subscriptions_plan_idx" ON "workspace_subscriptions" USING btree ("plan_key","subscription_status");