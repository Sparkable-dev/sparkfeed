import {

  OAuthError,
  OAuthErrorCode

} from '@modelcontextprotocol/server'
import { verifyApiKey } from '../api/keys'
import type {AuthInfo, OAuthTokenVerifier} from '@modelcontextprotocol/server';
import type { ApiPrincipal, Scope } from '../api/principal'

/**
 * Bridges Sparkfeed API keys to the MCP SDK's bearer-auth gate.
 *
 * The SDK hands us a raw token and wants an `AuthInfo` back, or an
 * `OAuthError` if the token is no good.
 */
export const sparkfeedVerifier: OAuthTokenVerifier = {
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const principal = await verifyApiKey(token)
    if (!principal) {
      throw new OAuthError(OAuthErrorCode.InvalidToken, 'Invalid, expired or revoked API key.')
    }

    return {
      token,
      clientId: principal.keyId,
      scopes: principal.scopes,
      // Required, despite being optional in the type. The SDK rejects any
      // AuthInfo without a numeric expiresAt outright:
      //   "Token has no expiration time" (index.mjs:1408).
      // Sparkfeed keys are non-expiring by design, so this is the lifetime of
      // *this assertion*, not of the key. Key expiry and revocation are
      // enforced in verifyApiKey, which runs on every request anyway.
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      extra: {
        workspaceId: principal.workspaceId,
        plan: principal.plan,
        keyId: principal.keyId,
        demo: principal.demo,
      },
    }
  },
}

/**
 * Rebuilds the principal from the AuthInfo the SDK threads through to the
 * server factory, so tools never re-parse a token.
 */
export function principalFromAuthInfo(authInfo: AuthInfo | undefined): ApiPrincipal {
  const extra = (authInfo?.extra ?? {})
  return {
    keyId: typeof extra.keyId === 'string' ? extra.keyId : 'key_unknown',
    workspaceId: typeof extra.workspaceId === 'string' ? extra.workspaceId : null,
    plan: (extra.plan as ApiPrincipal['plan']) ?? 'free',
    scopes: (authInfo?.scopes ?? []) as Array<Scope>,
    demo: extra.demo === true,
  }
}
