import { TOOL_REGISTRY } from "../tools/registry"
import { ServiceError } from "../services/errors"
import type { ToolDef } from "../tools/registry"
import type { ZodError } from "zod"

/**
 * Turning the tool registry into an HTTP surface.
 *
 * Everything here is generic: there is one handler for eleven endpoints, and it
 * learns what they are from `ToolDef.http`. The alternative — a route file per
 * endpoint — would be eleven places to forget a scope check.
 */

export interface MatchedRoute {
  tool: ToolDef
  /** Values captured from `{param}` segments in the path. */
  pathParams: Record<string, string>
}

/**
 * Resolves a method and path to a tool.
 *
 * Static segments beat parameterised ones, which is why `/articles/read` (a
 * write endpoint) is not swallowed by `/articles/{id}`. Sorting by parameter
 * count is enough to guarantee that here; anything more elaborate would be
 * pretending the route table is bigger than it is.
 */
export function matchRoute(method: string, path: string): MatchedRoute | null {
  const wanted = normalise(path)
  const candidates = TOOL_REGISTRY.filter((t) => t.http.method === method).sort(
    (a, b) => paramCount(a.http.path) - paramCount(b.http.path)
  )

  for (const tool of candidates) {
    const params = matchPath(tool.http.path, wanted)
    if (params) return { tool, pathParams: params }
  }
  return null
}

/** Whether any tool serves this path under a different method — a 405, not a 404. */
export function pathExists(path: string): boolean {
  const wanted = normalise(path)
  return TOOL_REGISTRY.some((t) => matchPath(t.http.path, wanted) !== null)
}

export function allowedMethodsFor(path: string): Array<string> {
  const wanted = normalise(path)
  return TOOL_REGISTRY.filter(
    (t) => matchPath(t.http.path, wanted) !== null
  ).map((t) => t.http.method)
}

function normalise(path: string): string {
  const trimmed = path.replace(/\/+$/, "")
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`
}

function paramCount(pattern: string): number {
  return (pattern.match(/\{[^}]+\}/g) ?? []).length
}

function matchPath(
  pattern: string,
  path: string
): Record<string, string> | null {
  const patternParts = pattern.split("/").filter(Boolean)
  const pathParts = path.split("/").filter(Boolean)
  if (patternParts.length !== pathParts.length) return null

  const params: Record<string, string> = {}
  for (const [i, part] of patternParts.entries()) {
    const actual = pathParts[i]
    const isParam = part.startsWith("{") && part.endsWith("}")
    if (isParam) {
      params[part.slice(1, -1)] = decodeURIComponent(actual)
    } else if (part !== actual) {
      return null
    }
  }
  return params
}

/**
 * Query strings are all strings; Zod schemas are not.
 *
 * This is the seam where a generated API usually goes wrong, in one of two
 * directions. Coerce too eagerly and `?limit=abc` becomes `NaN`, which sails
 * past a `z.number()` check and reaches a `LIMIT NaN`. Coerce not at all and
 * every numeric parameter is rejected. So: only convert when the value is
 * unambiguously of that type, and otherwise hand the original string to Zod so
 * *it* produces the error message, naming the field.
 *
 * Repeated keys (`?article_ids=a&article_ids=b`) become arrays, which is how
 * the array-valued write endpoints are addressed from a query string.
 */
export function coerceQuery(
  searchParams: URLSearchParams
): Record<string, unknown> {
  const out: Record<string, unknown> = {}

  for (const key of new Set(searchParams.keys())) {
    const values = searchParams.getAll(key)
    out[key] =
      values.length > 1 ? values.map(coerceScalar) : coerceScalar(values[0])
  }
  return out
}

function coerceScalar(value: string): unknown {
  if (value === "true") return true
  if (value === "false") return false
  // Strict numeric check: "12abc", "" and " " stay strings so Zod rejects them
  // with a message rather than silently becoming NaN.
  if (value !== "" && /^-?\d+(\.\d+)?$/.test(value)) {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return value
}

/** Zod issues, flattened into something an API consumer can act on. */
export function formatZodError(error: ZodError): Array<{
  field: string
  message: string
}> {
  return error.issues.map((issue) => ({
    field: issue.path.join(".") || "(root)",
    message: issue.message,
  }))
}

const STATUS_BY_CODE: Record<string, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  invalid_argument: 400,
  rate_limited: 429,
  entitlement_required: 402,
  upstream_failed: 502,
  not_implemented: 501,
}

/**
 * Maps a thrown value to a wire response.
 *
 * `ServiceError` messages are written to be acted on — "Narrow with folder_id
 * or since" — so they pass through. Anything else is logged server-side and
 * flattened, because an unexpected error's message may carry internals.
 */
export function errorPayload(error: unknown): {
  status: number
  body: { error: { code: string; message: string } & Record<string, unknown> }
} {
  if (error instanceof ServiceError) {
    return {
      status: STATUS_BY_CODE[error.code] ?? 400,
      body: {
        error: { code: error.code, message: error.message, ...error.detail },
      },
    }
  }

  console.error("[api/v1] unhandled error:", error)
  return {
    status: 500,
    body: {
      error: {
        code: "internal_error",
        message: "Something went wrong on our side.",
      },
    },
  }
}
