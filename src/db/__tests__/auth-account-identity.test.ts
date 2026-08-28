import { describe, expect, it } from "vitest"
import {
  AccountIdentityMigrationError,
  CREDENTIAL_ISSUER,
  backfillCredentialAccountIdentity,
} from "@/db/auth-account-identity"

describe("Better Auth 1.7 credential account backfill", () => {
  it("uses the linked user's stable id and is idempotent", () => {
    const legacyRows = [
      {
        id: "account-1",
        providerId: "credential",
        accountId: "mutable@example.com",
        userId: "user-1",
      },
    ]

    const migrated = backfillCredentialAccountIdentity(legacyRows)

    expect(migrated).toEqual([
      {
        id: "account-1",
        providerId: "credential",
        accountId: "user-1",
        userId: "user-1",
        issuer: CREDENTIAL_ISSUER,
      },
    ])
    expect(backfillCredentialAccountIdentity(migrated)).toEqual(migrated)
  })

  it("stops instead of inventing a trusted issuer for an unknown provider", () => {
    let thrown: unknown
    try {
      backfillCredentialAccountIdentity([
      {
        id: "account-1",
        providerId: "github",
        accountId: "123",
        userId: "user-1",
      },
      ])
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(AccountIdentityMigrationError)
    expect((thrown as AccountIdentityMigrationError).code).toBe("unexpected-provider")
  })

  it("detects collisions before a unique index would reject them", () => {
    let thrown: unknown
    try {
      backfillCredentialAccountIdentity([
      {
        id: "account-1",
        providerId: "credential",
        accountId: "legacy-1",
        userId: "user-1",
      },
      {
        id: "account-2",
        providerId: "credential",
        accountId: "legacy-2",
        userId: "user-1",
      },
      ])
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(AccountIdentityMigrationError)
    expect((thrown as AccountIdentityMigrationError).code).toBe("identity-collision")
  })
})
