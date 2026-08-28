import { SCOPES } from '../api/principal'

/**
 * OAuth discovery documents for the MCP endpoint.
 *
 * ## Why this file exists
 *
 * MCP clients that can do OAuth treat a `401` from an MCP endpoint as "this
 * server wants an OAuth handshake" and immediately probe the origin for
 * discovery metadata. We do not implement OAuth — a Sparkfeed API key is a
 * static bearer token — so the honest answer to most of those probes is `404`.
 *
 * That answer has to actually *be* a 404. The MCP client SDK tolerates any 4xx
 * during discovery and moves on, but throws on a 5xx and kills the client
 * process:
 *
 *   if (response.status >= 400 && response.status < 500) continue  // fine
 *   throw new Error(`HTTP ${response.status} trying to load OAuth metadata`)
 *
 * Before this, every unmatched path answered a JSON request with `500`
 * ("Only HTML requests are supported here", from TanStack Start's SSR
 * fallback), so a user who merely mistyped their key got an unreadable fatal
 * crash instead of "bad key". The `500 -> 404` rewrite lives in `src/start.ts`;
 * this file serves the one document we genuinely do have.
 *
 * ## What we serve
 *
 * RFC 9728 Protected Resource Metadata, and only that. It is the spec-correct
 * way to say "I am a resource server, I take bearer tokens in the header, and
 * there is no authorization server to talk to". Deliberately absent:
 * `authorization_servers`. Advertising an AS we do not run would send clients
 * into a registration flow against endpoints that do not exist — worse than
 * the 404 they get today.
 */

/** Path of the MCP endpoint itself, relative to the origin. */
export const MCP_PATH = '/api/mcp'

const PRM_PREFIX = '/.well-known/oauth-protected-resource'

/**
 * Both spellings of the metadata URL.
 *
 * RFC 9728 is path-aware: the resource's path is appended to the well-known
 * prefix, so `https://host/api/mcp` is described at
 * `/.well-known/oauth-protected-resource/api/mcp`. Clients also probe the bare
 * prefix, so both are served and both describe the same resource.
 */
export const PROTECTED_RESOURCE_PATHS: ReadonlyArray<string> = [
  PRM_PREFIX,
  `${PRM_PREFIX}${MCP_PATH}`,
]

/**
 * The origin the client actually used, which is what RFC 9728 requires the
 * `resource` value to match.
 *
 * Derived from the request rather than from an env var so that a self-hosted
 * deployment describes itself, not us. `x-forwarded-proto` is honoured because
 * behind Railway's proxy the inbound request is plain HTTP, and a metadata
 * document advertising an `http://` resource is rejected by strict clients.
 */
export function requestOrigin(request: Request): string {
  const url = new URL(request.url)
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const protocol = forwardedProto ? `${forwardedProto}:` : url.protocol
  return `${protocol}//${url.host}`
}

/** Absolute URL of the metadata document describing the MCP endpoint. */
export function protectedResourceMetadataUrl(origin: string): string {
  return `${origin}${PRM_PREFIX}${MCP_PATH}`
}

/** The RFC 9728 document itself. */
export function buildProtectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}${MCP_PATH}`,
    // The whole point: tokens go in the Authorization header, nowhere else.
    bearer_methods_supported: ['header'],
    scopes_supported: [...SCOPES],
    resource_name: 'Sparkfeed',
    resource_documentation: 'https://sparkfeed.dev/docs/developer/mcp/',
  }
}

const CORS_HEADERS: Record<string, string> = {
  // The documents are public and carry no credentials, so a blanket allow is
  // correct. Browser-based MCP clients read them cross-origin before they hold
  // any token at all.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, mcp-protocol-version',
  'Access-Control-Max-Age': '86400',
}

/**
 * Refuses RFC 7591 dynamic client registration, legibly.
 *
 * A client that gets a 401 from `/api/mcp` and finds no `authorization_servers`
 * in our metadata falls back to treating the resource as its own authorization
 * server, then POSTs to `<origin>/register` to register itself. We will never
 * answer that, but the default answer was actively misleading: `/register` is a
 * single path segment, so it matches the `/$folderSlug` page route, whose
 * loader redirects unknown slugs to `/`. The client followed the 307, POSTed to
 * the home page, got the HTML shell, and died on
 * `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.
 *
 * Scoped to non-GET methods on purpose. Folders live at `/$folderSlug` and a
 * user is entitled to name one "register"; their page loads are GETs and are
 * left completely alone. Registration is a POST.
 */
function dynamicRegistrationResponse(request: Request, pathname: string): Response | undefined {
  if (pathname !== '/register') return undefined
  if (request.method === 'GET' || request.method === 'HEAD') return undefined

  return Response.json(
    {
      error: 'invalid_request',
      error_description:
        'Sparkfeed does not implement OAuth or dynamic client registration. ' +
        'Authenticate with a Sparkfeed API key: `Authorization: Bearer sfk_live_…`. ' +
        'See https://sparkfeed.dev/docs/developer/mcp/',
    },
    { status: 404, headers: CORS_HEADERS },
  )
}

/**
 * Answers the `.well-known` routes we own, or `undefined` to fall through.
 *
 * Called from a TanStack Start request middleware, ahead of the router: file
 * based routing cannot express a path segment beginning with a dot, and these
 * documents must be reachable without touching auth or the database.
 */
export function wellKnownResponse(request: Request): Response | undefined {
  const { pathname } = new URL(request.url)

  const registration = dynamicRegistrationResponse(request, pathname)
  if (registration) return registration

  if (!PROTECTED_RESOURCE_PATHS.includes(pathname)) return undefined

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return Response.json(
      { error: 'method_not_allowed', error_description: 'Use GET.' },
      { status: 405, headers: { ...CORS_HEADERS, Allow: 'GET, OPTIONS' } },
    )
  }

  return Response.json(buildProtectedResourceMetadata(requestOrigin(request)), {
    headers: {
      ...CORS_HEADERS,
      // Discovery runs on every cold client start; a day of caching spares
      // both sides the round trip without making a redeploy hard to roll out.
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
