CREATE TABLE "articles" (
	"id" text PRIMARY KEY NOT NULL,
	"feed_id" text,
	"title" text NOT NULL,
	"description" text,
	"link" text NOT NULL,
	"image" text,
	"published_at" text,
	"is_used" boolean DEFAULT false,
	"visit_count" integer DEFAULT 0,
	"is_bookmarked" boolean DEFAULT false,
	"is_read_later" boolean DEFAULT false,
	"is_favorite" boolean DEFAULT false,
	"created_at" text
);
--> statement-breakpoint
CREATE TABLE "billing_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"company" text NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'pending',
	"created_at" text
);
--> statement-breakpoint
CREATE TABLE "feed_shares" (
	"feed_id" text PRIMARY KEY NOT NULL,
	"is_shared" boolean DEFAULT false NOT NULL,
	"password" text,
	"created_at" text
);
--> statement-breakpoint
CREATE TABLE "feeds" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"folder_id" text,
	"workspace_id" text,
	"include_keywords" text,
	"exclude_keywords" text,
	"created_at" text
);
--> statement-breakpoint
CREATE TABLE "folder_shares" (
	"folder_id" text PRIMARY KEY NOT NULL,
	"is_shared" boolean DEFAULT false NOT NULL,
	"password" text,
	"created_at" text
);
--> statement-breakpoint
CREATE TABLE "folders" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"workspace_id" text,
	"parent_id" text,
	"created_at" text
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"workspace_id" text,
	"role" text DEFAULT 'member' NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	CONSTRAINT "invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "password_resets" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	CONSTRAINT "password_resets_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "scraped_articles" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text,
	"folder_id" text,
	"site_url" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"date" text,
	"description" text,
	"created_at" timestamp,
	CONSTRAINT "scraped_articles_url_unique" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE "scraped_feeds" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text,
	"folder_id" text,
	"site_url" text NOT NULL,
	"title" text,
	"last_hash" text,
	"created_at" timestamp,
	CONSTRAINT "scraped_feeds_site_url_unique" UNIQUE("site_url")
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"metadata" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"active_organization_id" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_feed_id_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."feeds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_shares" ADD CONSTRAINT "feed_shares_feed_id_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."feeds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feeds" ADD CONSTRAINT "feeds_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder_shares" ADD CONSTRAINT "folder_shares_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_slug_uidx" ON "organization" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");