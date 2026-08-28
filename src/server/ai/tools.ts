import { tool } from "ai"
import { allowedTools } from "../tools/registry"
import { ServiceError } from "../services/errors"
import {
  ARTIFACT_MIN_AUTONOMY,
  ARTIFACT_TOOL_NAME,
  artifactTool,
} from "./artifacts"
import {
  WEB_SEARCH_MIN_AUTONOMY,
  WEB_SEARCH_TOOL_NAME,
  webSearchTool,
} from "./web-search"
import type { ToolSet } from "ai"
import type { ApiPrincipal } from "../api/principal"
import type { AutonomyId } from "@/config/autonomy"
import { AUTONOMY_RANK } from "@/config/autonomy"

/**
 * The registry, adapted to the AI SDK's tool map.
 *
 * The `execute` wrapper is the important part. **Tool errors are returned, not
 * thrown.** A thrown error inside `execute` aborts the entire stream, so one
 * bad id ends the conversation; a returned error object is just another tool
 * result — the model reads it, tells the user, and can correct itself and
 * retry. This mirrors the reasoning already written down for the MCP adapter in
 * `src/server/mcp/serialize.ts`, where the same choice is expressed as
 * `isError: true` rather than a JSON-RPC error.
 *
 * `ServiceError` messages are written for exactly this audience — "Narrow with
 * folder_id or since" is actionable to a model in a way that "invalid
 * argument" is not — so they pass through verbatim. Anything else is logged
 * server-side and flattened, because an unexpected error's message may contain
 * internals.
 */
export function buildChatTools(
  principal: ApiPrincipal,
  autonomy: AutonomyId
): ToolSet {
  const entries = allowedTools(principal, autonomy).map((def) => [
    def.name,
    tool({
      description: def.description,
      inputSchema: def.inputSchema,
      // `args` is deliberately left to inference. Annotating it (even as
      // `never`) makes TypeScript infer the tool's INPUT from the executor
      // rather than from the schema, and the schema then fails to match.
      execute: async (args) => {
        try {
          return await def.run(principal, args)
        } catch (err) {
          if (err instanceof ServiceError) {
            return {
              error: { code: err.code, message: err.message, ...err.detail },
            }
          }
          console.error(`[ai.tool] ${def.name} failed:`, err)
          return {
            error: {
              code: "internal_error",
              message:
                "That tool failed unexpectedly. Try a different approach.",
            },
          }
        }
      },
    }),
  ])

  /*
    Two tools live outside the registry, because the registry describes what a
    caller may do *to a workspace* and neither of these touches one. See
    `artifacts.ts` and `web-search.ts`.

    Neither is scope-gated for the same reason. Web search is autonomy-gated
    only in the sense that every tool is: `chatOnlyTools` filters on the level.
  */
  return {
    ...Object.fromEntries(entries),
    ...chatOnlyTools(principal, autonomy),
  } as ToolSet
}

/**
 * The chat-only pair, filtered by autonomy the same way the registry is.
 *
 * Web search is refused in demo outright: the demo deployment is public and
 * unauthenticated, and every search is a billable call to a second model.
 */
function chatOnlyTools(principal: ApiPrincipal, autonomy: AutonomyId) {
  const tools: Record<string, unknown> = {}

  if (AUTONOMY_RANK[autonomy] >= AUTONOMY_RANK[ARTIFACT_MIN_AUTONOMY]) {
    tools[ARTIFACT_TOOL_NAME] = artifactTool()
  }
  if (
    !principal.demo &&
    AUTONOMY_RANK[autonomy] >= AUTONOMY_RANK[WEB_SEARCH_MIN_AUTONOMY]
  ) {
    tools[WEB_SEARCH_TOOL_NAME] = webSearchTool()
  }

  return tools
}

/** Names of the tools this caller may use — handy for logging and tests. */
export function allowedToolNames(
  principal: ApiPrincipal,
  autonomy: AutonomyId
): Array<string> {
  return [
    ...allowedTools(principal, autonomy).map((t) => t.name),
    ...Object.keys(chatOnlyTools(principal, autonomy)),
  ]
}
