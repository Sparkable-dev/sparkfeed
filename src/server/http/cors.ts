/**
 * CORS for the public API.
 *
 * Deliberately an allowlist, not `*`. The `.well-known` discovery document uses
 * `*` because it is unauthenticated metadata that any MCP client must be able
 * to read; `/api/v1` carries a bearer token, and a wildcard on a credentialed
 * endpoint invites any page the reader happens to have open to spend their key.
 *
 * The origins are the docs site (whose playground calls the API live) and the
 * demo deployment. `API_CORS_ORIGINS` allows a self-hoster to add their own
 * without a code change.
 */

const DEFAULT_ORIGINS = [
  "https://sparkfeed.dev",
  "https://docs.sparkfeed.dev",
  "https://demo.sparkfeed.dev",
]

/** Local dev ports: the app, the docs site, and Astro's preview. */
const DEV_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:4321",
  "http://localhost:4322",
]

function allowedOrigins(): Array<string> {
  const extra = (process.env.API_CORS_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean)

  return [
    ...DEFAULT_ORIGINS,
    ...extra,
    ...(process.env.NODE_ENV === "production" ? [] : DEV_ORIGINS),
  ]
}

/**
 * Headers to attach to an API response.
 *
 * Returns nothing when the origin is absent (a curl or server-side call, which
 * needs no CORS) or unrecognised — an unknown origin gets a normal response
 * that the browser then refuses to hand to the page, which is the correct
 * outcome and leaks nothing about what is allowed.
 *
 * `Vary: Origin` is required: without it a cache can serve one origin's
 * response, headers and all, to another.
 */
export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin")
  if (!origin || !allowedOrigins().includes(origin)) return {}

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  }
}

/** Preflight. 204 with the headers, or 403 when the origin is not allowed. */
export function preflightResponse(request: Request): Response {
  const headers = corsHeaders(request)
  if (Object.keys(headers).length === 0) {
    return new Response(null, { status: 403 })
  }
  return new Response(null, { status: 204, headers })
}

/** JSON response with CORS applied. Every API reply goes through this. */
export function jsonResponse(
  request: Request,
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {}
): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status: init.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(request),
      ...init.headers,
    },
  })
}
