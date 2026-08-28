import { createFileRoute } from '@tanstack/react-router'
import { createMcpHandler, requireBearerAuth } from '@modelcontextprotocol/server'
import { buildMcpServer } from '@/server/mcp/server'
import { principalFromAuthInfo, sparkfeedVerifier } from '@/server/mcp/verifier'
import { checkRateLimit, clientIp } from '@/server/mcp/ratelimit'
import { protectedResourceMetadataUrl, requestOrigin } from '@/server/mcp/well-known'

/**
 * The MCP endpoint.
 *
 * `createMcpHandler` returns a web-standard `fetch(Request) => Response`, which
 * drops straight into a TanStack route handler with no adapter. The handler is
 * module-scoped (its notification bus should be stable) but the *factory* runs
 * per request, so no state is shared between tenants.
 */
const handler = createMcpHandler(buildMcpServer, {
  onerror: (err) => console.error('[mcp]', err),
})

/**
 * Built per request rather than at module scope so the challenge can name this
 * deployment's own origin. A self-hosted instance must point at its own
 * metadata document, not ours, and the value is just a closure — building one
 * costs nothing next to the request it authenticates.
 */
function buildGate(request: Request) {
  return requireBearerAuth({
    verifier: sparkfeedVerifier,
    // Every key carries `mcp`; this is what makes a scope-less token a 403
    // rather than something a tool has to notice.
    requiredScopes: ['mcp'],
    // RFC 9728: a 401 must tell the client where to learn about this resource.
    // Without it a client that hits a bad key has nowhere to look and starts
    // guessing at OAuth endpoints instead.
    resourceMetadataUrl: protectedResourceMetadataUrl(requestOrigin(request)),
  })
}

async function serve(request: Request): Promise<Response> {
  const auth = await buildGate(request)(request)
  // The gate returns a ready-made 401/403 with the WWW-Authenticate challenge.
  if (auth instanceof Response) return auth

  const principal = principalFromAuthInfo(auth)
  // The demo key is public and shared, so it is limited per client address;
  // a real key is limited per key.
  const bucketKey = principal.demo ? `demo:${clientIp(request)}` : principal.keyId
  const limit = checkRateLimit(bucketKey, { demo: principal.demo })

  if (!limit.ok) {
    return new Response(
      JSON.stringify({
        error: {
          code: 'rate_limited',
          message: 'Too many requests. Slow down and retry.',
          retry_after_ms: limit.retryAfterMs,
        },
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(Math.ceil(limit.retryAfterMs / 1000)),
        },
      },
    )
  }

  return handler.fetch(request, { authInfo: auth })
}

export const Route = createFileRoute('/api/mcp')({
  server: {
    handlers: {
      POST: ({ request }) => serve(request),
      // GET and DELETE are registered so the protocol answers them itself
      // (405 in stateless mode) instead of TanStack returning a 404, which
      // clients surface as a confusing "server not found".
      GET: ({ request }) => serve(request),
      DELETE: ({ request }) => serve(request),
    },
  },
})
