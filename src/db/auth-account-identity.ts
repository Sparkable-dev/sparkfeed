/**
 * The only account identity mapping Sparkfeed can establish from its own
 * configuration and existing relational data. Keep this in sync with the
 * reviewed SQL in drizzle/0010_married_misty_knight.sql.
 */
export const CREDENTIAL_PROVIDER_ID = "credential"
export const CREDENTIAL_ISSUER = "local:credential"

export type LegacyAuthAccount = {
  id: string
  providerId: string
  accountId: string
  userId: string
  issuer?: string | null
}

export class AccountIdentityMigrationError extends Error {
  constructor(
    message: string,
    readonly code: "unexpected-provider" | "identity-collision",
  ) {
    super(message)
    this.name = "AccountIdentityMigrationError"
  }
}

/**
 * Returns the data state required by Better Auth 1.7 without mutating the
 * input. Unknown providers are deliberately rejected: their issuer cannot be
 * derived safely from an email address or a mutable OAuth endpoint.
 */
export function backfillCredentialAccountIdentity(
  accounts: ReadonlyArray<LegacyAuthAccount>,
): Array<LegacyAuthAccount> {
  const unexpectedProviders = [...new Set(
    accounts
      .filter((account) => account.providerId !== CREDENTIAL_PROVIDER_ID)
      .map((account) => account.providerId),
  )]

  if (unexpectedProviders.length > 0) {
    throw new AccountIdentityMigrationError(
      "Non-credential accounts need a reviewed trusted issuer mapping before the Better Auth 1.7 migration can run.",
      "unexpected-provider",
    )
  }

  const migrated = accounts.map((account) => ({
    ...account,
    issuer: CREDENTIAL_ISSUER,
    accountId: account.userId,
  }))

  const identityCounts = new Map<string, number>()
  for (const account of migrated) {
    const key = `${account.issuer}\u0000${account.accountId}`
    identityCounts.set(key, (identityCounts.get(key) ?? 0) + 1)
  }

  if ([...identityCounts.values()].some((count) => count > 1)) {
    throw new AccountIdentityMigrationError(
      "Issuer/account identity collisions need manual resolution before the Better Auth 1.7 migration can run.",
      "identity-collision",
    )
  }

  return migrated
}
