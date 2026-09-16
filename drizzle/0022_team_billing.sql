CREATE TABLE "team_billing_state" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"attempt_id" text NOT NULL,
	"checkout_session_id" text,
	"checkout_url" text,
	"interval" text NOT NULL,
	"seats" integer NOT NULL,
	"last_synced_at" text,
	"scheduled_interval" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team_billing_state" ADD CONSTRAINT "team_billing_state_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;