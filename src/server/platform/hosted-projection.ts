const userFields = [
  "id",
  "name",
  "email",
  "emailVerified",
  "image",
  "role",
  "banned",
  "banReason",
  "banExpires",
  "createdAt",
  "updatedAt",
  "lastActiveAt",
]
const sessionFields = [
  "id",
  "userId",
  "createdAt",
  "updatedAt",
  "expiresAt",
  "ipAddress",
  "userAgent",
  "activeOrganizationId",
  "impersonatedBy",
]
const accountFields = [
  "id",
  "userId",
  "providerId",
  "accountId",
  "issuer",
  "scope",
  "createdAt",
  "updatedAt",
]
function pick(value: unknown, fields: Array<string>) {
  if (!value || typeof value !== "object") return {}
  const record = value as Record<string, unknown>
  return Object.fromEntries(
    fields.filter((key) => key in record).map((key) => [key, record[key]])
  )
}
/** Positive projections prevent new provider fields from leaking credentials. */
export function redactHostedCredentials(value: unknown): unknown {
  const record = value as Record<string, unknown>
  return {
    ...pick(value, userFields),
    account: Array.isArray(record?.account)
      ? record.account.map((item) => pick(item, accountFields))
      : [],
    session: Array.isArray(record?.session)
      ? record.session.map((item) => pick(item, sessionFields))
      : [],
    twoFactorStatus: ["enabled", "pending", "disabled"].includes(
      String(record?.twoFactorStatus)
    )
      ? record.twoFactorStatus
      : undefined,
  }
}
