import { describe, expect, it } from 'vitest'
import { isUnroutableSsrResponse, notFoundResponse } from '../not-found'

/**
 * The sentinel these tests pin is TanStack Start's, not ours
 * (`@tanstack/start-server-core/src/createStartHandler.ts`). If a Start upgrade
 * changes the wording, the first test here fails — which is the point. Silent
 * failure would mean every JSON client goes back to seeing 500s for paths that
 * simply do not exist, and MCP clients go back to dying on discovery.
 */
const startsNonHtmlRefusal = () =>
  Response.json({ error: 'Only HTML requests are supported here' }, { status: 500 })

describe('isUnroutableSsrResponse', () => {
  it('recognises Start’s non-HTML SSR refusal', async () => {
    await expect(isUnroutableSsrResponse(startsNonHtmlRefusal())).resolves.toBe(true)
  })

  it('leaves the response readable, so a non-match can still be returned as-is', async () => {
    const response = startsNonHtmlRefusal()
    await isUnroutableSsrResponse(response)
    await expect(response.json()).resolves.toEqual({
      error: 'Only HTML requests are supported here',
    })
  })

  it('does not touch a genuine 500 from a handler', async () => {
    const real = Response.json({ error: 'database unavailable' }, { status: 500 })
    await expect(isUnroutableSsrResponse(real)).resolves.toBe(false)
  })

  it('does not touch a non-JSON 500', async () => {
    const html = new Response('<h1>oops</h1>', {
      status: 500,
      headers: { 'content-type': 'text/html' },
    })
    await expect(isUnroutableSsrResponse(html)).resolves.toBe(false)
  })

  it('ignores successful responses', async () => {
    await expect(isUnroutableSsrResponse(Response.json({ ok: true }))).resolves.toBe(false)
  })

  it('survives a 500 with an unparseable body', async () => {
    const broken = new Response('not json', {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
    await expect(isUnroutableSsrResponse(broken)).resolves.toBe(false)
  })
})

describe('notFoundResponse', () => {
  it('is a 4xx, which is what MCP clients walk past during discovery', () => {
    expect(notFoundResponse().status).toBe(404)
  })
})
