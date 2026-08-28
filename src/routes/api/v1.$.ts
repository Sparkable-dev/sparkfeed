import { createFileRoute } from "@tanstack/react-router"
import { requireBearerAuth } from "@modelcontextprotocol/server"
import { principalFromAuthInfo, sparkfeedVerifier } from "@/server/mcp/verifier"
import { checkRateLimit, clientIp } from "@/server/mcp/ratelimit"
import {
  protectedResourceMetadataUrl,
  requestOrigin,
} from "@/server/mcp/well-known"
import {
  allowedMethodsFor,
  coerceQuery,
  errorPayload,
  formatZodError,
  matchRoute,
  pathExists,
} from "@/server/api/rest"
import {
  corsHeaders,
  jsonResponse,
  preflightResponse,
} from "@/server/http/cors"
import { buildOpenApiDocument } from "@/server/api/openapi"

/**
 * The REST API.
 *
 * One handler for every endpoint. The route table lives in
 * `src/server/tools/registry.ts`, so this file contains no knowledge of what
 * `/feeds` or `/articles/{id}` are — which is the point: a new tool becomes a
 * new endpoint with the same auth, the same scope check and the same error
 * shape, with nothing here to update and nothing to forget.
 *
 * Authentication is deliberately identical to `/api/mcp`: the same keys, the
 * same verifier, and the same RFC 9728 `WWW-Authenticate` challenge on a 401 so
 * a client that hits a bad key is told where to read about this resource
 * instead of guessing at OAuth endpoints.
 */

const API_PREFIX = "/api/v1"

function pathOf(request: Request): string {
  const { pathname } = new URL(request.url)
  return pathname.slice(API_PREFIX.length) || "/"
}

/** Built per request so the challenge names this deployment's own origin. */
function buildGate(request: Request) {
  return requireBearerAuth({
    verifier: sparkfeedVerifier,
    // Every key carries `mcp`; a token without it is a 403 here rather than
    // something each endpoint has to notice.
    requiredScopes: ["mcp"],
    resourceMetadataUrl: protectedResourceMetadataUrl(requestOrigin(request)),
  })
}

async function serve(request: Request): Promise<Response> {
  const path = pathOf(request)
  const method = request.method.toUpperCase()

  // The spec is served here rather than from its own route file because this
  // splat would shadow one anyway. It is public and unauthenticated: a spec
  // describes the shape of an API, not its contents, and a reader needs it
  // before they have a key.
  if (path === "/openapi.json" && method === "GET") {
    return jsonResponse(request, buildOpenApiDocument(requestOrigin(request)), {
      headers: { "Cache-Control": "public, max-age=300" },
    })
  }

  const route = matchRoute(method, path)
  if (!route) {
    // A path that exists under another verb is a 405 with Allow, not a 404 —
    // otherwise POSTing to a GET endpoint reads as "no such endpoint".
    if (pathExists(path)) {
      const allow = allowedMethodsFor(path)
      return jsonResponse(
        request,
        {
          error: {
            code: "method_not_allowed",
            message: `${method} is not supported here. Try ${allow.join(" or ")}.`,
          },
        },
        { status: 405, headers: { Allow: [...allow, "OPTIONS"].join(", ") } }
      )
    }
    return jsonResponse(
      request,
      {
        error: {
          code: "not_found",
          message: `No endpoint at ${path}. See ${API_PREFIX}/openapi.json for the full list.`,
        },
      },
      { status: 404 }
    )
  }

  // ── Authentication ───────────────────────────────────────────────────────
  const auth = await buildGate(request)(request)
  if (auth instanceof Response) {
    // The gate builds its own 401/403 with the challenge; CORS still has to be
    // added or the browser hides the status from the page.
    const headers = new Headers(auth.headers)
    for (const [key, value] of Object.entries(corsHeaders(request))) {
      headers.set(key, value)
    }
    return new Response(auth.body, { status: auth.status, headers })
  }

  const principal = principalFromAuthInfo(auth)

  // ── Rate limiting ────────────────────────────────────────────────────────
  // The demo key is public and shared, so it is limited per client address; a
  // real key is limited per key. Same buckets as MCP, deliberately: one key
  // should not get double the budget by switching transport.
  const bucketKey = principal.demo
    ? `demo:${clientIp(request)}`
    : principal.keyId
  const limit = checkRateLimit(bucketKey, { demo: principal.demo })
  if (!limit.ok) {
    return jsonResponse(
      request,
      {
        error: {
          code: "rate_limited",
          message: "Too many requests. Slow down and retry.",
          retry_after_ms: limit.retryAfterMs,
        },
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)),
        },
      }
    )
  }

  // ── Authorization ────────────────────────────────────────────────────────
  const { tool, pathParams } = route
  if (tool.scope && !principal.scopes.includes(tool.scope)) {
    return jsonResponse(
      request,
      {
        error: {
          code: "forbidden",
          message: `This key lacks the "${tool.scope}" scope.`,
          required_scope: tool.scope,
        },
      },
      { status: 403 }
    )
  }

  // ── Input ────────────────────────────────────────────────────────────────
  let raw: Record<string, unknown>
  try {
    const url = new URL(request.url)
    raw =
      tool.http.paramsIn === "body"
        ? ((await request.json().catch(() => ({}))) as Record<string, unknown>)
        : coerceQuery(url.searchParams)
  } catch {
    return jsonResponse(
      request,
      {
        error: {
          code: "invalid_argument",
          message: "Request body must be JSON.",
        },
      },
      { status: 400 }
    )
  }

  // Path params win: `/articles/{id}` is more specific than a stray `?id=`.
  const parsed = tool.inputSchema.safeParse({ ...raw, ...pathParams })
  if (!parsed.success) {
    return jsonResponse(
      request,
      {
        error: {
          code: "invalid_argument",
          message: "Some parameters are missing or the wrong type.",
          issues: formatZodError(parsed.error),
        },
      },
      { status: 400 }
    )
  }

  // ── Run ──────────────────────────────────────────────────────────────────
  try {
    const result = await tool.run(principal, parsed.data)
    return jsonResponse(request, result)
  } catch (error) {
    const { status, body } = errorPayload(error)
    return jsonResponse(request, body, { status })
  }
}

export const Route = createFileRoute("/api/v1/$")({
  server: {
    handlers: {
      GET: ({ request }: { request: Request }) => serve(request),
      POST: ({ request }: { request: Request }) => serve(request),
      PATCH: ({ request }: { request: Request }) => serve(request),
      OPTIONS: ({ request }: { request: Request }) =>
        preflightResponse(request),
    },
  },
})
