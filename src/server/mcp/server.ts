import { McpServer  } from '@modelcontextprotocol/server'
import { registerTools } from './tools'
import { principalFromAuthInfo } from './verifier'
import type {McpServerFactory} from '@modelcontextprotocol/server';

/**
 * Builds one MCP server per request.
 *
 * `createMcpHandler` calls this factory for every HTTP request, which is what
 * makes the stateless design safe: nothing is shared between tenants because
 * nothing outlives the request. The principal is resolved once here and closed
 * over by the tools.
 */
export const buildMcpServer: McpServerFactory = ({ authInfo }) => {
  const principal = principalFromAuthInfo(authInfo)

  const server = new McpServer(
    { name: 'sparkfeed', version: '0.1.0' },
    {
      instructions:
        'Sparkfeed is the user\'s RSS reader: a curated set of feeds they chose to follow. ' +
        'Start with get_workspace_info to see what is here. Use search_articles to find things ' +
        '(omit `query` for the most recent), then get_article for the full text of one post. ' +
        'Search returns short snippets by design, so read the full article before summarising it.',
    },
  )

  registerTools(server, principal)
  return server
}
