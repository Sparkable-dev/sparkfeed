/**
 * Read-only pre-deploy check for the Better Auth 1.7 account migration.
 *
 * This deliberately prints counts, never account identifiers or credentials.
 * It exits non-zero when an operator must establish a trusted issuer mapping
 * or resolve collisions before deploying the committed migration.
 */
import postgres from "postgres"
import {
  AccountIdentityMigrationError,
  backfillCredentialAccountIdentity,
} from "../src/db/auth-account-identity"

const url = process.env.DATABASE_URL
if (!url) {
  console.error("[auth-1-7-check] DATABASE_URL is required.")
  process.exit(1)
}

const client = postgres(url, { max: 1 })

try {
  const accounts = await client<{
    id: string
    providerId: string
    accountId: string
    userId: string
    issuer: string | null
  }[]>`
    SELECT
      "id",
      "provider_id" AS "providerId",
      "account_id" AS "accountId",
      "user_id" AS "userId",
      "issuer"
    FROM "account"
  `

  backfillCredentialAccountIdentity(accounts)
  console.log(
    `[auth-1-7-check] ${accounts.length} account row(s) are ready for the credential-only migration.`,
  )
} catch (error) {
  if (error instanceof AccountIdentityMigrationError) {
    console.error(`[auth-1-7-check] ${error.message}`)
  } else {
    console.error("[auth-1-7-check] Could not complete the preflight check.")
  }
  process.exitCode = 1
} finally {
  await client.end({ timeout: 5 })
}
