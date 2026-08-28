import { describe, expect, it } from 'vitest'
import { BlockedUrlError, assertPublicUrl, looksLikeFeedContentType } from '../fetch'

async function expectBlocked(url: string) {
  await expect(assertPublicUrl(url)).rejects.toBeInstanceOf(BlockedUrlError)
}

describe('assertPublicUrl', () => {
  it('rejects non-http schemes', async () => {
    await expectBlocked('ftp://example.com/feed.xml')
    await expectBlocked('file:///etc/passwd')
    await expectBlocked('javascript:alert(1)')
  })

  it('rejects malformed input', async () => {
    await expectBlocked('not a url')
    await expectBlocked('')
  })

  it('rejects embedded credentials', async () => {
    await expectBlocked('https://user:pass@example.com/feed')
  })

  it('rejects loopback and localhost', async () => {
    await expectBlocked('http://localhost:3000/')
    await expectBlocked('http://127.0.0.1/')
    await expectBlocked('http://127.1.2.3/')
    await expectBlocked('http://[::1]/')
  })

  it('rejects private IPv4 ranges', async () => {
    await expectBlocked('http://10.0.0.1/')
    await expectBlocked('http://172.16.0.1/')
    await expectBlocked('http://172.31.255.254/')
    await expectBlocked('http://192.168.1.1/')
    await expectBlocked('http://0.0.0.0/')
  })

  it('rejects cloud metadata endpoints', async () => {
    await expectBlocked('http://169.254.169.254/latest/meta-data/')
    await expectBlocked('http://metadata.google.internal/')
  })

  it('rejects CGNAT and multicast', async () => {
    await expectBlocked('http://100.64.0.1/')
    await expectBlocked('http://224.0.0.1/')
    await expectBlocked('http://255.255.255.255/')
  })

  it('rejects private IPv6 and IPv4-mapped private addresses', async () => {
    await expectBlocked('http://[fd00::1]/')
    await expectBlocked('http://[fe80::1]/')
    await expectBlocked('http://[::ffff:10.0.0.1]/')
  })

  it('rejects internal-only hostname suffixes', async () => {
    await expectBlocked('http://printer.local/')
    await expectBlocked('http://db.internal/')
  })

  it('does not reject a public IP literal', async () => {
    const url = await assertPublicUrl('https://1.1.1.1/feed.xml')
    expect(url.hostname).toBe('1.1.1.1')
  })

  it('allows 172.32.x, which is outside the private block', async () => {
    const url = await assertPublicUrl('http://172.32.0.1/')
    expect(url.hostname).toBe('172.32.0.1')
  })
})

describe('looksLikeFeedContentType', () => {
  it('accepts feed and xml types', () => {
    expect(looksLikeFeedContentType('application/rss+xml')).toBe(true)
    expect(looksLikeFeedContentType('application/atom+xml; charset=utf-8')).toBe(true)
    expect(looksLikeFeedContentType('text/xml')).toBe(true)
    expect(looksLikeFeedContentType('application/json')).toBe(true)
  })

  it('accepts a missing content type, which many feeds ship with', () => {
    expect(looksLikeFeedContentType('')).toBe(true)
    expect(looksLikeFeedContentType('text/plain')).toBe(true)
  })

  it('rejects html', () => {
    expect(looksLikeFeedContentType('text/html; charset=utf-8')).toBe(false)
  })
})

describe('assertPublicUrl: public ranges that must NOT be blocked', () => {
  it('allows 192.0.66.x, which is public despite sitting in 192.0/16', async () => {
    // Regression: blocking all of 192.0.0.0/16 made github.blog (192.0.66.2)
    // unreachable. Only 192.0.0.0/24 and 192.0.2.0/24 are reserved.
    const url = await assertPublicUrl('https://192.0.66.2/feed')
    expect(url.hostname).toBe('192.0.66.2')
  })

  it('still blocks the two reserved 192.0 /24s', async () => {
    await expectBlocked('http://192.0.0.8/')
    await expectBlocked('http://192.0.2.1/')
  })
})
