import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { and, desc, eq, isNull } from "drizzle-orm"
import { DEFAULT_SCOPES, DEMO_SCOPES, isScope } from "./principal"
import type { ApiPrincipal, Scope } from "./principal"
import { db } from "@/db/index"
import { apiKeys } from "@/db/schema"
import { DEMO_MODE, DEMO_WORKSPACE_ID } from "@/lib/demo"

/**
 * API key minting and verification.
 *
 * Only the sha256 of a key is stored. The raw value is returned once at mint
 * time and is unrecoverable afterwards, which is why the UI has to present it
 * as a one-time reveal.
 */

const LIVE_PREFIX = "sfk_live_"
const DEMO_PREFIX = "sfk_demo_"
/** How much of the raw key is kept in cleartext for display. */
const DISPLAY_PREFIX_LEN = 16

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function generateRawKey(): string {
  // 32 bytes base64url: ~256 bits, URL-safe, no ambiguous characters to
  // transcribe out of a config file.
  return `${LIVE_PREFIX}${randomBytes(32).toString("base64url")}`
}

/** Constant-time compare of two hex digests of equal length. */
function digestsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"))
}

/**
 * The demo principal.
 *
 * Demo has no `api_keys` table (its SQLite schema is created by
 * `ensureDemoSchema`, which only builds the ten app tables), no better-auth
 * tables, and an ephemeral database wiped on every deploy, so a DB-backed key
 * cannot work there. The key lives in a runtime env var instead.
 *
 * `MCP_DEMO_API_KEY_SHA256` holds a digest rather than the key itself, so the
 * deployed environment never contains the credential. If it is unset the demo
 * endpoint is open: the key is published in the docs anyway, so treating it as
 * a secret would be theatre, and an open demo is one less step for a visitor.
 */
function demoPrincipal(): ApiPrincipal {
  return {
    keyId: "key_demo",
    workspaceId: DEMO_WORKSPACE_ID,
    plan: "pro",
    scopes: DEMO_SCOPES,
    demo: true,
  }
}

/**
 * Resolves a raw bearer token to a principal, or null if it is not valid.
 *
 * One function, two branches, the same `ApiPrincipal` out of both, so nothing
 * downstream knows or cares whether it is running in demo.
 */
export async function verifyApiKey(raw: string): Promise<ApiPrincipal | null> {
  const token = raw.trim()
  if (!token) return null

  if (DEMO_MODE) {
    const expected = process.env.MCP_DEMO_API_KEY_SHA256
    if (!expected) return demoPrincipal()
    if (!token.startsWith(DEMO_PREFIX)) return null
    return digestsMatch(sha256(token), expected.trim().toLowerCase())
      ? demoPrincipal()
      : null
  }

  // A demo key must never be accepted by production, even if one leaks into the
  // production database somehow.
  if (token.startsWith(DEMO_PREFIX)) return null

  const [row] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.hash, sha256(token)), isNull(apiKeys.revokedAt)))
    .limit(1)

  if (!row) return null
  if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now())
    return null

  // Fire and forget: a failed usage stamp must never fail the request.
  void db
    .update(apiKeys)
    .set({ lastUsedAt: new Date().toISOString() })
    .where(eq(apiKeys.id, row.id))
    .catch(() => {})

  return {
    keyId: row.id,
    workspaceId: row.workspaceId,
    // Entitlements do not exist yet (PROD-62/63). Until they do, holding a key
    // is the entitlement; the field is here so the check has somewhere to go.
    plan: "pro",
    scopes: parseScopes(row.scopes),
    demo: false,
  }
}

function parseScopes(value: string): Array<Scope> {
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return DEFAULT_SCOPES
    const scopes = parsed.filter(
      (s): s is Scope => typeof s === "string" && isScope(s)
    )
    return scopes.length ? scopes : DEFAULT_SCOPES
  } catch {
    return DEFAULT_SCOPES
  }
}

export interface MintedKey {
  id: string
  name: string
  /** Shown once, never retrievable again. */
  key: string
  prefix: string
  scopes: Array<Scope>
  createdAt: string
}

/**
 * Creates a key for a workspace. The caller resolves `workspaceId` from the
 * session; it is never accepted from client input.
 */
export async function mintApiKey(opts: {
  workspaceId: string
  userId: string | null
  name: string
  scopes?: Array<Scope>
}): Promise<MintedKey> {
  const raw = generateRawKey()
  const id = `key_${randomBytes(12).toString("hex")}`
  const scopes = opts.scopes?.length ? opts.scopes : DEFAULT_SCOPES
  const createdAt = new Date().toISOString()
  const prefix = raw.slice(0, DISPLAY_PREFIX_LEN)

  await db.insert(apiKeys).values({
    id,
    workspaceId: opts.workspaceId,
    createdByUserId: opts.userId,
    name: opts.name,
    hash: sha256(raw),
    prefix,
    scopes: JSON.stringify(scopes),
    createdAt,
  })

  return { id, name: opts.name, key: raw, prefix, scopes, createdAt }
}

export async function listApiKeys(workspaceId: string) {
  const rows = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      scopes: apiKeys.scopes,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.workspaceId, workspaceId), isNull(apiKeys.revokedAt)))
    .orderBy(desc(apiKeys.createdAt))

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    scopes: parseScopes(r.scopes),
    lastUsedAt: r.lastUsedAt,
    createdAt: r.createdAt,
  }))
}

/**
 * Soft revoke. The row is kept so `last_used_at` and the name remain available
 * for an audit trail; verification already filters on `revoked_at is null`.
 *
 * Scoped by workspace so a key id from another workspace cannot be revoked.
 */
export async function revokeApiKey(
  workspaceId: string,
  keyId: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.workspaceId, workspaceId)))
    .limit(1)

  if (!row) return false

  await db
    .update(apiKeys)
    .set({ revokedAt: new Date().toISOString() })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.workspaceId, workspaceId)))

  return true
}
