CREATE TABLE "personal_favorites" (
	"user_id" text NOT NULL,
	"article_id" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "personal_favorites_user_id_article_id_pk" PRIMARY KEY("user_id","article_id")
);
--> statement-breakpoint
ALTER TABLE "personal_favorites" ADD CONSTRAINT "personal_favorites_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_favorites" ADD CONSTRAINT "personal_favorites_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "personal_favorites_article_idx" ON "personal_favorites" USING btree ("article_id");
--> statement-breakpoint
-- Existing team saves remain workspace favorites. Personal-workspace saves
-- have a known owner and can be recovered without guessing who saved them.
INSERT INTO "personal_favorites" ("user_id", "article_id", "created_at")
SELECT u.id, a.id, coalesce(a.created_at, CURRENT_TIMESTAMP::text)
FROM articles a JOIN feeds f ON f.id = a.feed_id JOIN "user" u ON u.id = f.workspace_id
WHERE a.is_favorite = true
ON CONFLICT DO NOTHING;
