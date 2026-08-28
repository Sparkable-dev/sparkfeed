/**
 * Client configuration snippets, and the connection test behind the button on
 * the MCP page.
 *
 * ## Why these are generated rather than written out in prose
 *
 * The old snippets shipped the literal string `Authorization: Bearer YOUR_KEY`
 * and asked the reader to substitute their key by hand, inside a value whose
 * `Bearer ` prefix is load-bearing. People dropped it — and a header without
 * the scheme is a 401, which makes an OAuth-capable client abandon the token
 * and start a handshake this server does not implement. The failure surfaced
 * nowhere near the cause.
 *
 * So: take the key as input, build the whole snippet, and let the user copy it
 * whole. Nothing to substitute means nothing to get wrong.
 */

/** Shown until the user pastes a real key. Never a valid credential. */
export const KEY_PLACEHOLDER = 'sfk_live_YOUR_KEY'

/** Sparkfeed keys always carry one of these prefixes. */
const KEY_PREFIXES = ['sfk_live_', 'sfk_demo_']

export function looksLikeKey(value: string): boolean {
  return KEY_PREFIXES.some((prefix) => value.startsWith(prefix))
}

/**
 * Strips what people actually paste.
 *
 * Copying from a config file or a docs page tends to bring along the header
 * name, the scheme, or surrounding quotes. All of that is recoverable, and
 * silently recovering it is better than rendering a snippet containing
 * `Bearer Bearer sfk_live_…`.
 */
export function normalizeKey(input: string): string {
  return input
    .trim()
    .replace(/^Authorization\s*:\s*/i, '')
    .replace(/^Bearer\s+/i, '')
    .replace(/^["']|["']$/g, '')
    .trim()
}

const withKey = (key: string) => normalizeKey(key) || KEY_PLACEHOLDER

/** Claude Code, which takes the header on the command line. */
export function claudeCodeCommand(endpoint: string, key: string): string {
  return `claude mcp add --transport http sparkfeed ${endpoint} \\\n  --header "Authorization: Bearer ${withKey(key)}"`
}

/** Cursor, VS Code, and anything else reading a plain MCP config file. */
export function httpClientConfig(endpoint: string, key: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        sparkfeed: {
          type: 'http',
          url: endpoint,
          headers: { Authorization: `Bearer ${withKey(key)}` },
        },
      },
    },
    null,
    2,
  )
}

/**
 * The `mcp-remote` bridge, in the form its own README prescribes.
 *
 * The header value lives in `env` rather than inline in `args` because Claude
 * Desktop and Cursor do not escape spaces when they invoke npx, which mangles
 * any argument containing one. `Authorization:${…}` has no space; the space
 * that matters sits safely inside the environment variable.
 */
export function mcpRemoteConfig(endpoint: string, key: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        sparkfeed: {
          command: 'npx',
          args: ['-y', 'mcp-remote', endpoint, '--header', 'Authorization:${SPARKFEED_AUTH}'],
          env: { SPARKFEED_AUTH: `Bearer ${withKey(key)}` },
        },
      },
    },
    null,
    2,
  )
}

/** What Claude Desktop's connector dialog wants typed into its header field. */
export function connectorHeaderValue(key: string): string {
  return `Bearer ${withKey(key)}`
}

/**
 * Pulls the JSON-RPC payload out of a Streamable HTTP response.
 *
 * The endpoint answers `text/event-stream` even for a single reply, so the body
 * arrives as `event: message` / `data: {…}` rather than bare JSON.
 */
export function parseSseJson(body: string): unknown {
  const data = body
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim())
    .join('')

  if (!data) return null
  try {
    return JSON.parse(data)
  } catch {
    return null
  }
}

export type ConnectionTest =
  | { ok: true; tools: Array<string> }
  | { ok: false; status?: number; message: string }

/**
 * One round trip that answers "is this key actually working".
 *
 * `tools/list` rather than `initialize`: the endpoint is stateless, so a tool
 * listing stands alone, and it reports scopes as well as authentication —
 * write tools are only registered for a key carrying `articles:write`, so the
 * returned names are the ground truth about what this key can do.
 */
export async function testConnection(
  endpoint: string,
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ConnectionTest> {
  const token = normalizeKey(key)
  if (!token) return { ok: false, message: 'Paste a key first.' }

  let response: Response
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    })
  } catch {
    return { ok: false, message: 'Could not reach the endpoint.' }
  }

  const body = await response.text()

  if (!response.ok) {
    const parsed = safeJson(body)
    return {
      ok: false,
      status: response.status,
      message:
        parsed?.error_description ??
        parsed?.error ??
        describeStatus(response.status),
    }
  }

  const payload = parseSseJson(body) as
    | { result?: { tools?: Array<{ name?: unknown }> } }
    | null

  const tools = payload?.result?.tools
  if (!Array.isArray(tools)) {
    return { ok: false, status: response.status, message: 'The server returned an unexpected reply.' }
  }

  return { ok: true, tools: tools.map((tool) => String(tool.name)) }
}

function safeJson(body: string): { error?: string; error_description?: string } | null {
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

function describeStatus(status: number): string {
  if (status === 401) return 'The key was rejected. Check it has not been revoked.'
  if (status === 403) return 'The key is valid but lacks the scopes this endpoint requires.'
  if (status === 429) return 'Rate limited. Wait a moment and try again.'
  return `The server answered ${status}.`
}
