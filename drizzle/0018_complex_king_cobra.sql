CREATE TABLE "platform_activity_days" (
	"user_id" text NOT NULL,
	"workspace_type" text NOT NULL,
	"workspace_id" text NOT NULL,
	"day" text NOT NULL,
	"last_seen_at" text NOT NULL,
	CONSTRAINT "platform_activity_days_user_id_workspace_type_workspace_id_day_pk" PRIMARY KEY("user_id","workspace_type","workspace_id","day")
);
--> statement-breakpoint
ALTER TABLE "platform_activity_days" ADD CONSTRAINT "platform_activity_days_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_activity_day_idx" ON "platform_activity_days" USING btree ("day");