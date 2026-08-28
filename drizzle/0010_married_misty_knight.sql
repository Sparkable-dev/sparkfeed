-- Generated from the Drizzle schema diff, then expanded into a safe migration.
--
-- Better Auth 1.7 identifies an account by (issuer, account_id). Sparkfeed's
-- configured authentication mode is email/password only, so credential rows
-- have the documented mapping below:
--
--   provider_id = credential  -> issuer = local:credential
--   account_id                -> the linked user's stable id
--
-- Do not add a synthetic mapping for an unexpected provider here. A non-
-- credential provider requires a provider-specific trusted issuer and must be
-- mapped during a maintenance window before this migration is retried.
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "issuer" text;--> statement-breakpoint

DO $$
DECLARE
  unexpected_provider_count integer;
  collision_count integer;
BEGIN
  SELECT count(DISTINCT "provider_id")
  INTO unexpected_provider_count
  FROM "account"
  WHERE "provider_id" <> 'credential';

  IF unexpected_provider_count > 0 THEN
    RAISE EXCEPTION
      USING
        ERRCODE = 'P0001',
        MESSAGE = 'Better Auth 1.7 account migration stopped: non-credential provider rows need a reviewed trusted issuer mapping',
        DETAIL = format('%s distinct non-credential provider IDs were found. Run the documented pre-deploy inventory and map them explicitly before retrying.', unexpected_provider_count);
  END IF;

  -- The update is idempotent: an already-correct row is left untouched, and a
  -- stale legacy credential account_id is repaired from its immutable user id.
  UPDATE "account" AS account
  SET
    "issuer" = 'local:credential',
    "account_id" = "user"."id"
  FROM "user"
  WHERE account."user_id" = "user"."id"
    AND account."provider_id" = 'credential'
    AND (
      account."issuer" IS DISTINCT FROM 'local:credential'
      OR account."account_id" IS DISTINCT FROM "user"."id"
    );

  IF EXISTS (SELECT 1 FROM "account" WHERE "issuer" IS NULL) THEN
    RAISE EXCEPTION
      USING
        ERRCODE = 'P0001',
        MESSAGE = 'Better Auth 1.7 account migration stopped: one or more account rows have no issuer after backfill';
  END IF;

  SELECT count(*)
  INTO collision_count
  FROM (
    SELECT "issuer", "account_id"
    FROM "account"
    GROUP BY "issuer", "account_id"
    HAVING count(*) > 1
  ) AS collisions;

  IF collision_count > 0 THEN
    RAISE EXCEPTION
      USING
        ERRCODE = 'P0001',
        MESSAGE = 'Better Auth 1.7 account migration stopped: issuer/account identity collisions require manual resolution',
        DETAIL = format('%s collision group(s) found. Do not merge users by email; resolve the ownership from trusted provider data before retrying.', collision_count);
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "account" ALTER COLUMN "issuer" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "account_issuer_accountId_uidx" ON "account" USING btree ("issuer", "account_id");
