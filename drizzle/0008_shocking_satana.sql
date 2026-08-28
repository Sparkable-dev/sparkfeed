CREATE TABLE "chat_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"seq" integer NOT NULL,
	"role" text NOT NULL,
	"parts" text NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"created_at" text
);
--> statement-breakpoint
CREATE TABLE "chat_threads" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"created_at" text,
	"updated_at" text,
	"archived_at" text
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_thread_id_chat_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_messages_thread_idx" ON "chat_messages" USING btree ("thread_id","seq");--> statement-breakpoint
CREATE INDEX "chat_threads_owner_idx" ON "chat_threads" USING btree ("user_id","workspace_id");--> statement-breakpoint
CREATE INDEX "chat_threads_updated_idx" ON "chat_threads" USING btree ("updated_at");