-- Retire customer-record administration and its MFA enrollment.
-- Run only after the old admin deployment is stopped. Staff MFA lives in a
-- separate database and is deliberately outside this migration.
DELETE FROM "session"
WHERE "user_id" IN (
  SELECT "id" FROM "user"
  WHERE "two_factor_enabled" = true
    OR 'admin' = ANY(regexp_split_to_array("role", '\s*,\s*'))
  UNION SELECT "user_id" FROM "two_factor"
) OR "impersonated_by" IS NOT NULL;
--> statement-breakpoint
UPDATE "user" SET "role" = 'user', "updated_at" = now()
WHERE 'admin' = ANY(regexp_split_to_array("role", '\s*,\s*'));
--> statement-breakpoint
DROP TABLE "two_factor";
--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "two_factor_enabled";
