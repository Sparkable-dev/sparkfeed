import { TOOL_REGISTRY } from '../../tools/registry'
import { guard } from '../serialize'
import type { McpServer } from '@modelcontextprotocol/server'
import type { ApiPrincipal } from '../../api/principal'

/**
 * Tool registration.
 *
 * The definitions themselves live in `src/server/tools/registry.ts`, shared
 * with the in-app chat's AI SDK tool map. This file is now purely the MCP
 * adapter: it takes those definitions and hands them to `McpServer` in the
 * shape it wants. Keeping the two consumers over one list is the point — a
 * tool defined twice is a tool that eventually disagrees with itself.
 *
 * Tools are registered against a principal that is closed over, so the
 * workspace anchor is a constructor argument rather than something each handler
 * has to remember to read off the request. It is impossible to forget.
 *
 * Registration is conditional on scope, which means `tools/list` is already
 * correct for the caller: a read-only key never sees the write tools, so the
 * model is not offered something it will be refused. Note this now applies to
 * the *read* tools too — they previously declared `workspace:read` and
 * `articles:read` in the scope list but nothing enforced them, so any key with
 * `mcp` could read everything.
 *
 * Autonomy is not consulted here. It is a chat-session concept (the composer
 * pill); an MCP key's ceiling is its scopes, full stop.
 */
export function registerTools(server: McpServer, principal: ApiPrincipal) {
  for (const tool of TOOL_REGISTRY) {
    if (tool.scope && !principal.scopes.includes(tool.scope)) continue

    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: {
          ...tool.annotations,
          // A demo key never triggers an outbound fetch, so advertising an open
          // world would be wrong for it specifically.
          openWorldHint: principal.demo ? false : tool.annotations.openWorldHint,
        },
      },
      guard(
        (args: any) => tool.run(principal, args),
        (result) => tool.summarize(result),
      ),
    )
  }
}
