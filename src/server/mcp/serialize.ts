import { ServiceError } from '../services/errors'

/**
 * Shapes a service result into a `CallToolResult`.
 *
 * The MCP convention is to put the payload in `content` as JSON text *and* in
 * `structuredContent`, which sends it twice. Instead the structured field
 * carries the data and `content` carries a one-line human summary, so the wire
 * cost is paid once. Modern clients read `structuredContent`; the summary is
 * what a human sees in a client's tool log.
 */
export function toolResult(payload: Record<string, unknown>, summary: string) {
  return {
    content: [{ type: 'text' as const, text: summary }],
    structuredContent: payload,
  }
}

/**
 * Turns a thrown error into a tool result the model can act on.
 *
 * `isError: true` rather than a protocol-level failure: a tool that says
 * "narrow your query" in a form the model can read gets a better next call than
 * a JSON-RPC error, which most clients surface as an opaque failure.
 */
export function toolError(err: unknown) {
  if (err instanceof ServiceError) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `${err.code}: ${err.message}` }],
      structuredContent: err.toJSON(),
    }
  }

  // Never leak an internal message or stack to an API consumer.
  console.error('[mcp] unhandled tool error:', err)
  return {
    isError: true,
    content: [{ type: 'text' as const, text: 'internal_error: Something went wrong on our side.' }],
    structuredContent: {
      error: { code: 'internal_error', message: 'Something went wrong on our side.' },
    },
  }
}

/** Wraps a tool handler so every thrown ServiceError becomes a clean result. */
export function guard<TArgs>(
  fn: (args: TArgs) => Promise<Record<string, unknown>>,
  summarize: (r: any) => string,
) {
  return async (args: TArgs) => {
    try {
      const result = await fn(args)
      return toolResult(result, summarize(result))
    } catch (err) {
      return toolError(err)
    }
  }
}
