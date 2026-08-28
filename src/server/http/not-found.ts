/**
 * Turns TanStack Start's "I can only render HTML" 500 into a real 404.
 *
 * When no route matches, Start falls through to SSR, which refuses any request
 * whose `Accept` header does not include `text/html`:
 *
 *   if (!accepts('text/html') && !accepts('star/star')) return Response.json(
 *     { error: 'Only HTML requests are supported here' }, { status: 500 })
 *
 * (`@tanstack/start-server-core/src/createStartHandler.ts`.)
 *
 * So every JSON-speaking client that asked for a path we do not serve — a
 * mistyped `/api/…`, a `.well-known` probe, a health check, a scanner — was
 * told the server had failed. That is wrong on its own terms, it poisons
 * error-rate monitoring, and for MCP it was fatal: the client SDK walks past a
 * 4xx during OAuth discovery but throws on a 5xx.
 *
 * Matching on the sentinel string is deliberate. It is the one signal that
 * distinguishes "nothing routed this" from a genuine 500 raised inside a
 * handler, which must keep its status. If a future Start release changes the
 * wording we fall back to today's behaviour rather than swallowing real
 * failures — and the test pinning this string fails loudly on upgrade.
 */
const UNROUTABLE_SENTINEL = "Only HTML requests are supported here"

/** Whether a response is Start's non-HTML SSR refusal rather than a real 500. */
export async function isUnroutableSsrResponse(
  response: Response
): Promise<boolean> {
  if (response.status !== 500) return false
  if (!response.headers.get("content-type")?.includes("application/json"))
    return false

  // Cloned so the original stays readable if we decide not to rewrite it.
  const body = await response
    .clone()
    .json()
    .catch(() => null)

  return (body as { error?: unknown } | null)?.error === UNROUTABLE_SENTINEL
}

/** The 404 those requests should have received all along. */
export function notFoundResponse(): Response {
  return Response.json(
    { error: "not_found", error_description: "No route matches this path." },
    { status: 404 }
  )
}
