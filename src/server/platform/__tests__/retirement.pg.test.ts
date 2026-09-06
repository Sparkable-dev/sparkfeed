import { readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import postgres from "postgres"
import { describe, expect, it } from "vitest"

// Exercise the actual migration against populated legacy auth records.
// The isolated schema allows this test to run on an already migrated QA database.
describe.runIf(process.env.RUN_PLATFORM_POSTGRES_TESTS === "true")(
  "embedded admin retirement migration",
  () => {
    it("revokes legacy sessions and MFA without changing customer ownership or billing", async () => {
      const url = process.env.DATABASE_URL
      if (!url || !new URL(url).pathname.endsWith("_qa"))
        throw new Error("Tests require a disposable *_qa database")
      const client = postgres(url, { max: 1 })
      const namespace = `retirement_${randomUUID().replaceAll("-", "")}`
      try {
        await client.begin(async (tx) => {
          await tx.unsafe(`CREATE SCHEMA "${namespace}"`)
          await tx.unsafe(`SET LOCAL search_path TO "${namespace}"`)
          await tx.unsafe(`
          CREATE TABLE "user" (id text PRIMARY KEY, role text, two_factor_enabled boolean, updated_at timestamp, dodo_customer_id text);
          CREATE TABLE session (id text PRIMARY KEY, user_id text, impersonated_by text);
          CREATE TABLE two_factor (id text PRIMARY KEY, user_id text, secret text);
          CREATE TABLE member (user_id text, organization_id text, role text);
          CREATE TABLE workspace_subscriptions (workspace_id text, dodo_subscription_id text);
          CREATE TABLE platform_admin_audit_log (actor_user_id text);
          INSERT INTO "user" VALUES ('admin', 'user, admin', true, now(), 'cus-kept'), ('customer', 'user', false, now(), 'cus-personal'), ('pending', 'user', false, now(), null);
          INSERT INTO session VALUES ('old-admin', 'admin', null), ('customer-session', 'customer', null), ('old-support', 'customer', 'admin'), ('pending-enrollment', 'pending', null);
          INSERT INTO two_factor VALUES ('enrolled', 'admin', 'old-secret'), ('pending', 'pending', 'pending-secret');
          INSERT INTO member VALUES ('admin', 'team', 'owner'), ('customer', 'team', 'editor');
          INSERT INTO workspace_subscriptions VALUES ('customer', 'sub-kept');
          INSERT INTO platform_admin_audit_log VALUES ('admin');
        `)
          const migration = readFileSync(
            new URL(
              "../../../../drizzle/0019_retire_embedded_admin.sql",
              import.meta.url
            ),
            "utf8"
          )
          for (const statement of migration.split("--> statement-breakpoint"))
            await tx.unsafe(statement)
          expect(await tx`SELECT id FROM session`).toEqual([
            { id: "customer-session" },
          ])
          expect(
            await tx`SELECT role, dodo_customer_id FROM "user" WHERE id='admin'`
          ).toEqual([{ role: "user", dodo_customer_id: "cus-kept" }])
          expect(await tx`SELECT count(*)::int AS count FROM "user"`).toEqual([
            { count: 3 },
          ])
          expect(
            await tx`SELECT role FROM member WHERE user_id='admin'`
          ).toEqual([{ role: "owner" }])
          expect(
            await tx`SELECT dodo_subscription_id FROM workspace_subscriptions`
          ).toEqual([{ dodo_subscription_id: "sub-kept" }])
          expect(
            await tx`SELECT actor_user_id FROM platform_admin_audit_log`
          ).toEqual([{ actor_user_id: "admin" }])
          expect(
            await tx`SELECT to_regclass('two_factor') AS table_name`
          ).toEqual([{ table_name: null }])
          expect(
            await tx`SELECT column_name FROM information_schema.columns WHERE table_schema=${namespace} AND table_name='user' AND column_name='two_factor_enabled'`
          ).toEqual([])
          await tx.unsafe(`DROP SCHEMA "${namespace}" CASCADE`)
        })
      } finally {
        await client.end()
      }
    })
  }
)
