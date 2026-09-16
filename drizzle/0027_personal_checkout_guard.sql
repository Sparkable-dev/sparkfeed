CREATE TABLE "personal_checkout_state" (
	"user_id" text PRIMARY KEY NOT NULL,
	"attempt_id" text NOT NULL,
	"checkout_session_id" text,
	"checkout_url" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "personal_checkout_state" ADD CONSTRAINT "personal_checkout_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;