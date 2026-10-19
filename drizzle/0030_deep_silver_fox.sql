CREATE TABLE "customer_auth_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text,
	"action" text NOT NULL,
	"method" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_auth_events" ADD CONSTRAINT "customer_auth_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_auth_events_user_time_idx" ON "customer_auth_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "customer_auth_events_session_idx" ON "customer_auth_events" USING btree ("session_id");