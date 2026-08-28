import { describe, expect, it } from 'vitest'
import {
  KEY_PLACEHOLDER,
  claudeCodeCommand,
  connectorHeaderValue,
  httpClientConfig,
  looksLikeKey,
  mcpRemoteConfig,
  normalizeKey,
  parseSseJson,
  testConnection,
} from '../mcp-config'

const ENDPOINT = 'https://beta.sparkfeed.dev/api/mcp'
const KEY = 'sfk_live_abc123'

describe('normalizeKey', () => {
  it('accepts a bare key', () => {
    expect(normalizeKey(KEY)).toBe(KEY)
  })

  it.each([
    ['Bearer sfk_live_abc123'],
    ['bearer sfk_live_abc123'],
    ['Authorization: Bearer sfk_live_abc123'],
    ['  sfk_live_abc123  '],
    ['"sfk_live_abc123"'],
  ])('recovers the key from %j', (pasted) => {
    // People paste whole config lines. Recovering beats rendering
    // `Bearer Bearer sfk_live_…` into the snippet they then copy.
    expect(normalizeKey(pasted)).toBe(KEY)
  })
})

describe('looksLikeKey', () => {
  it('recognises live and demo prefixes', () => {
    expect(looksLikeKey('sfk_live_x')).toBe(true)
    expect(looksLikeKey('sfk_demo_public')).toBe(true)
  })

  it('rejects anything else, so the UI can warn early', () => {
    expect(looksLikeKey('ghp_somethingelse')).toBe(false)
  })
})

describe('generated snippets', () => {
  it('always carry the Bearer scheme — the bug that started all this', () => {
    // A header without the scheme is a 401, which sends OAuth-capable clients
    // into a handshake this server does not implement.
    expect(claudeCodeCommand(ENDPOINT, KEY)).toContain(`Bearer ${KEY}`)
    expect(httpClientConfig(ENDPOINT, KEY)).toContain(`Bearer ${KEY}`)
    expect(mcpRemoteConfig(ENDPOINT, KEY)).toContain(`Bearer ${KEY}`)
    expect(connectorHeaderValue(KEY)).toBe(`Bearer ${KEY}`)
  })

  it('never double up the scheme when the user pastes it', () => {
    expect(connectorHeaderValue('Bearer sfk_live_abc123')).toBe(`Bearer ${KEY}`)
    expect(httpClientConfig(ENDPOINT, 'Bearer sfk_live_abc123')).not.toContain('Bearer Bearer')
  })

  it('falls back to an obvious placeholder rather than an empty header', () => {
    expect(httpClientConfig(ENDPOINT, '')).toContain(`Bearer ${KEY_PLACEHOLDER}`)
  })

  it('produces valid JSON', () => {
    expect(() => JSON.parse(httpClientConfig(ENDPOINT, KEY))).not.toThrow()
    expect(() => JSON.parse(mcpRemoteConfig(ENDPOINT, KEY))).not.toThrow()
  })
})

describe('mcpRemoteConfig', () => {
  const parsed = () => JSON.parse(mcpRemoteConfig(ENDPOINT, KEY)).mcpServers.sparkfeed

  it('keeps every arg free of spaces', () => {
    // Claude Desktop and Cursor do not escape spaces when invoking npx, so an
    // arg containing one arrives mangled. This is why the token lives in env.
    for (const arg of parsed().args as Array<string>) {
      expect(arg).not.toContain(' ')
    }
  })

  it('puts the scheme in the environment variable instead', () => {
    expect(parsed().env.SPARKFEED_AUTH).toBe(`Bearer ${KEY}`)
    expect(parsed().args).toContain('Authorization:${SPARKFEED_AUTH}')
  })
})

describe('parseSseJson', () => {
  it('reads a Streamable HTTP reply', () => {
    expect(parseSseJson('event: message\ndata: {"result":{"tools":[]}}\n\n')).toEqual({
      result: { tools: [] },
    })
  })

  it('joins a payload split across data lines', () => {
    expect(parseSseJson('data: {"a":\ndata: 1}\n\n')).toEqual({ a: 1 })
  })

  it('returns null for a body with no data frame', () => {
    expect(parseSseJson('event: ping\n\n')).toBeNull()
  })

  it('returns null rather than throwing on malformed JSON', () => {
    expect(parseSseJson('data: {oops\n\n')).toBeNull()
  })
})

describe('testConnection', () => {
  const sse = (payload: unknown) =>
    new Response(`event: message\ndata: ${JSON.stringify(payload)}\n\n`, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })

  it('reports the tools a key can actually see', async () => {
    const result = await testConnection(ENDPOINT, KEY, async () =>
      sse({ result: { tools: [{ name: 'list_folders' }, { name: 'get_article' }] } }),
    )
    expect(result).toEqual({ ok: true, tools: ['list_folders', 'get_article'] })
  })

  it('sends the scheme, so the test exercises the real path', async () => {
    let sent: string | null = null
    await testConnection(ENDPOINT, KEY, async (_url, init) => {
      sent = new Headers(init?.headers).get('authorization')
      return sse({ result: { tools: [] } })
    })
    expect(sent).toBe(`Bearer ${KEY}`)
  })

  it('surfaces the server’s own error description on a 401', async () => {
    const result = await testConnection(ENDPOINT, KEY, async () =>
      Response.json(
        { error: 'invalid_token', error_description: 'Invalid, expired or revoked API key.' },
        { status: 401 },
      ),
    )
    expect(result).toEqual({
      ok: false,
      status: 401,
      message: 'Invalid, expired or revoked API key.',
    })
  })

  it('explains a 403 as a scope problem', async () => {
    const result = await testConnection(ENDPOINT, KEY, async () => new Response('', { status: 403 }))
    expect(result).toMatchObject({ ok: false, status: 403 })
    expect((result as { message: string }).message).toContain('scopes')
  })

  it('does not fire a request without a key', async () => {
    let called = false
    const result = await testConnection(ENDPOINT, '  ', async () => {
      called = true
      return sse({})
    })
    expect(called).toBe(false)
    expect(result).toMatchObject({ ok: false })
  })

  it('reports an unreachable endpoint instead of throwing', async () => {
    const result = await testConnection(ENDPOINT, KEY, async () => {
      throw new TypeError('network')
    })
    expect(result).toMatchObject({ ok: false, message: 'Could not reach the endpoint.' })
  })
})
