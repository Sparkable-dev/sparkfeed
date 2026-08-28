/**
 * Who an API key represents.
 *
 * This is the only thing the services layer knows about authentication. It
 * carries the tenancy anchor (`workspaceId`), what the caller may do
 * (`scopes`), and whether this is the shared demo key, which is read-only and
 * must never trigger an outbound fetch.
 */
export interface ApiPrincipal {
  /** Key id, `key_…`. `demo` for the shared demo key, which has no row. */
  keyId: string
  workspaceId: string | null
  plan: "free" | "pro" | "enterprise"
  scopes: Array<Scope>
  demo: boolean
}

/**
 * Scopes, aligned to the tool categories rather than to individual tools, so a
 * new read tool does not require every existing key to be re-minted.
 *
 * `mcp` is the entry ticket: `requireBearerAuth` is configured with it as a
 * required scope, so every key must carry it.
 */
export const SCOPES = [
  "mcp",
  "workspace:read",
  "articles:read",
  "articles:write",
  "feeds:write",
  "refresh",
] as const

export type Scope = (typeof SCOPES)[number]

/** What a key gets when the user does not choose. Read-only plus curation. */
export const DEFAULT_SCOPES: Array<Scope> = [
  "mcp",
  "workspace:read",
  "articles:read",
  "articles:write",
]

/** The demo key. Strictly read-only: no writes, no refresh, no outbound fetch. */
export const DEMO_SCOPES: Array<Scope> = [
  "mcp",
  "workspace:read",
  "articles:read",
]

export function isScope(value: string): value is Scope {
  return (SCOPES as ReadonlyArray<string>).includes(value)
}
