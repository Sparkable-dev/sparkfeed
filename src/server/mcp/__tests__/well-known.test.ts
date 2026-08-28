import { describe, expect, it } from 'vitest'
import {
  buildProtectedResourceMetadata,
  protectedResourceMetadataUrl,
  requestOrigin,
  wellKnownResponse,
} from '../well-known'

const get = (url: string, init?: RequestInit) => new Request(url, init)

describe('requestOrigin', () => {
  it('uses the request origin', () => {
    expect(requestOrigin(get('https://beta.sparkfeed.dev/api/mcp'))).toBe(
      'https://beta.sparkfeed.dev',
    )
  })

  it('trusts x-forwarded-proto, because Railway terminates TLS at the edge', () => {
    const request = get('http://beta.sparkfeed.dev/api/mcp', {
      headers: { 'x-forwarded-proto': 'https' },
    })
    expect(requestOrigin(request)).toBe('https://beta.sparkfeed.dev')
  })

  it('takes the first value when the proxy chain appends several', () => {
    const request = get('http://beta.sparkfeed.dev/api/mcp', {
      headers: { 'x-forwarded-proto': 'https, http' },
    })
    expect(requestOrigin(request)).toBe('https://beta.sparkfeed.dev')
  })
})

describe('protected resource metadata', () => {
  it('describes the MCP endpoint, not the origin', () => {
    const doc = buildProtectedResourceMetadata('https://beta.sparkfeed.dev')
    expect(doc.resource).toBe('https://beta.sparkfeed.dev/api/mcp')
  })

  it('advertises header-only bearer auth', () => {
    expect(buildProtectedResourceMetadata('https://x.dev').bearer_methods_supported).toEqual([
      'header',
    ])
  })

  it('claims no authorization server, because there is none', () => {
    // Advertising an AS we do not run would send clients into a registration
    // flow against endpoints that do not exist. Absence is the honest answer.
    expect(buildProtectedResourceMetadata('https://x.dev')).not.toHaveProperty(
      'authorization_servers',
    )
  })

  it('points the 401 challenge at the path-aware RFC 9728 URL', () => {
    expect(protectedResourceMetadataUrl('https://beta.sparkfeed.dev')).toBe(
      'https://beta.sparkfeed.dev/.well-known/oauth-protected-resource/api/mcp',
    )
  })
})

describe('wellKnownResponse', () => {
  it('serves the path-aware metadata URL', async () => {
    const res = wellKnownResponse(
      get('https://x.dev/.well-known/oauth-protected-resource/api/mcp'),
    )
    expect(res?.status).toBe(200)
    await expect(res!.json()).resolves.toMatchObject({ resource: 'https://x.dev/api/mcp' })
  })

  it('serves the bare prefix too, since clients probe both', () => {
    expect(wellKnownResponse(get('https://x.dev/.well-known/oauth-protected-resource'))?.status).toBe(
      200,
    )
  })

  it('is readable cross-origin', () => {
    const res = wellKnownResponse(get('https://x.dev/.well-known/oauth-protected-resource'))
    expect(res?.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('answers preflight', () => {
    const res = wellKnownResponse(
      get('https://x.dev/.well-known/oauth-protected-resource', { method: 'OPTIONS' }),
    )
    expect(res?.status).toBe(204)
  })

  it('rejects writes to the metadata document', () => {
    const res = wellKnownResponse(
      get('https://x.dev/.well-known/oauth-protected-resource', { method: 'POST' }),
    )
    expect(res?.status).toBe(405)
    expect(res?.headers.get('allow')).toBe('GET, OPTIONS')
  })

  it('falls through for the authorization server document, which must 404', () => {
    // A 404 is what lets an MCP client walk past discovery. A 5xx here is
    // fatal to the client process — that was the original bug.
    expect(wellKnownResponse(get('https://x.dev/.well-known/oauth-authorization-server'))).toBeUndefined()
  })

  it('falls through for unrelated paths', () => {
    expect(wellKnownResponse(get('https://x.dev/tech'))).toBeUndefined()
  })
})

describe('dynamic client registration', () => {
  it('refuses a registration POST with an actionable message', async () => {
    const res = wellKnownResponse(get('https://x.dev/register', { method: 'POST' }))
    expect(res?.status).toBe(404)
    const body = await res!.json()
    expect(body.error_description).toContain('Bearer')
  })

  it('leaves GET /register to the router, so a folder may be named "register"', () => {
    expect(wellKnownResponse(get('https://x.dev/register'))).toBeUndefined()
  })
})
