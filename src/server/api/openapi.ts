import { z } from "zod"
import { TOOL_REGISTRY } from "../tools/registry"
import type { ToolDef } from "../tools/registry"

/**
 * The OpenAPI document, generated from the tool registry.
 *
 * Generated rather than written, for the reason the docs already demonstrate:
 * a hand-maintained description of an API drifts, and this repo's own
 * documentation spent a release promising a REST API that did not exist. Here
 * the spec cannot describe an endpoint that is not routed, or omit one that is.
 *
 * Schemas come from `z.toJSONSchema()`, native to zod 4 — no converter
 * dependency. `io: "input"` matters: it emits the shape a *caller sends*, which
 * for a schema with defaults or transforms differs from what the parser
 * returns, and the caller's view is the one a request body should document.
 */

const VERSION = "1.0.0"

interface JsonSchemaObject {
  type?: string
  properties?: Record<string, { description?: string; [k: string]: unknown }>
  required?: Array<string>
  [k: string]: unknown
}

function schemaFor(tool: ToolDef): JsonSchemaObject {
  return z.toJSONSchema(tool.inputSchema, {
    io: "input",
    // Inline everything. A reader of one endpoint's page should not have to
    // resolve a $ref into a components section to learn what `limit` is.
    reused: "inline",
  }) as JsonSchemaObject
}

/** `{id}` segments become path parameters; the rest depend on `paramsIn`. */
function pathParamNames(path: string): Array<string> {
  return (path.match(/\{([^}]+)\}/g) ?? []).map((p) => p.slice(1, -1))
}

function operationFor(tool: ToolDef) {
  const schema = schemaFor(tool)
  const properties = schema.properties ?? {}
  const required = new Set(schema.required ?? [])
  const inPath = new Set(pathParamNames(tool.http.path))

  const parameters = Object.entries(properties)
    .filter(([name]) => inPath.has(name) || tool.http.paramsIn === "query")
    .map(([name, prop]) => {
      const { description, ...rest } = prop
      return {
        name,
        in: inPath.has(name) ? "path" : "query",
        required: inPath.has(name) || required.has(name),
        ...(description ? { description } : {}),
        schema: rest,
      }
    })

  // Body endpoints keep every non-path field in the body, so the two never
  // describe the same argument twice.
  const bodyProperties = Object.fromEntries(
    Object.entries(properties).filter(([name]) => !inPath.has(name))
  )
  const hasBody =
    tool.http.paramsIn === "body" && Object.keys(bodyProperties).length > 0

  return {
    operationId: tool.name,
    summary: tool.title,
    description: tool.description,
    tags: [tagFor(tool)],
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(hasBody
      ? {
          requestBody: {
            required: [...required].some((r) => !inPath.has(r)),
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: bodyProperties,
                  required: [...required].filter((r) => !inPath.has(r)),
                },
              },
            },
          },
        }
      : {}),
    security: [{ bearerAuth: tool.scope ? [tool.scope] : [] }],
    responses: {
      "200": {
        description: tool.title,
        content: { "application/json": { schema: { type: "object" } } },
      },
      "400": errorResponse("Invalid or missing parameters."),
      "401": errorResponse("Missing or invalid API key."),
      "403": errorResponse(
        tool.scope
          ? `The key lacks the "${tool.scope}" scope.`
          : "The key is not permitted to do this."
      ),
      "429": errorResponse("Rate limit exceeded. See Retry-After."),
    },
    "x-scope": tool.scope,
    "x-read-only": tool.annotations.readOnlyHint,
  }
}

function errorResponse(description: string) {
  return {
    description,
    content: {
      "application/json": {
        schema: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                code: { type: "string" },
                message: { type: "string" },
              },
              required: ["code", "message"],
            },
          },
          required: ["error"],
        },
      },
    },
  }
}

/** Groups the sidebar renders. Derived from the first path segment. */
function tagFor(tool: ToolDef): string {
  const segment = tool.http.path.split("/").filter(Boolean)[0] ?? "general"
  return segment.charAt(0).toUpperCase() + segment.slice(1)
}

/**
 * The origin baked into the committed snapshot the docs site reads.
 *
 * A live request gets its own origin, so this only names the deployment a
 * reader lands on when the docs were built without one. It is exported so the
 * snapshot script and the test that guards it cannot disagree about which
 * document they are comparing.
 */
export const SNAPSHOT_ORIGIN = "https://beta.sparkfeed.dev"

export function buildOpenApiDocument(origin: string) {
  const paths: Record<string, Record<string, unknown>> = {}

  for (const tool of TOOL_REGISTRY) {
    const path = tool.http.path
    paths[path] ??= {}
    paths[path][tool.http.method.toLowerCase()] = operationFor(tool)
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Sparkfeed API",
      version: VERSION,
      description:
        "Read and manage a Sparkfeed workspace: folders, feeds and articles. " +
        "The same capabilities are available over MCP at /api/mcp — both are " +
        "generated from one definition, so they never disagree.",
    },
    servers: [
      { url: `${origin}/api/v1`, description: "This deployment" },
      {
        url: "https://demo.sparkfeed.dev/api/v1",
        description: "Public demo workspace, read-only",
      },
    ],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description:
            "An API key from Developer → API Keys, sent as `Authorization: Bearer sfk_live_…`. " +
            "The public demo key `sfk_demo_public` works against the demo server and is read-only.",
        },
      },
    },
    tags: [...new Set(TOOL_REGISTRY.map(tagFor))].map((name) => ({ name })),
    paths,
  }
}
