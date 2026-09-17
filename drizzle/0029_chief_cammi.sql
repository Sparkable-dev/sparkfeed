CREATE TABLE "ai_usage_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_type" text NOT NULL,
	"workspace_id" text NOT NULL,
	"beneficiary_user_id" text NOT NULL,
	"plan_key" text NOT NULL,
	"requested_model_id" text,
	"provider_id" text,
	"upstream_model_id" text,
	"status" text NOT NULL,
	"reserved_credits" numeric(20, 6) DEFAULT 0 NOT NULL,
	"charged_credits" numeric(20, 6) DEFAULT 0 NOT NULL,
	"cost_usd" numeric(20, 10) DEFAULT 0 NOT NULL,
	"unpriced_steps" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"cached_input_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"step_count" integer DEFAULT 0 NOT NULL,
	"started_at" text NOT NULL,
	"completed_at" text
);
--> statement-breakpoint
CREATE TABLE "ai_usage_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"kind" text NOT NULL,
	"provider_id" text NOT NULL,
	"model_id" text NOT NULL,
	"response_id" text,
	"generation_id" text,
	"finish_reason" text,
	"cost_usd" numeric(20, 10),
	"charged_credits" numeric(20, 6) DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"cached_input_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credit_ledger" ALTER COLUMN "amount" SET DATA TYPE numeric(20, 6);--> statement-breakpoint
ALTER TABLE "ai_usage_steps" ADD CONSTRAINT "ai_usage_steps_request_id_ai_usage_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."ai_usage_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_requests_member_idx" ON "ai_usage_requests" USING btree ("workspace_type","workspace_id","beneficiary_user_id","started_at");--> statement-breakpoint
CREATE INDEX "ai_usage_requests_workspace_idx" ON "ai_usage_requests" USING btree ("workspace_type","workspace_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_usage_steps_request_sequence_uidx" ON "ai_usage_steps" USING btree ("request_id","sequence");--> statement-breakpoint
CREATE INDEX "ai_usage_steps_generation_idx" ON "ai_usage_steps" USING btree ("generation_id");