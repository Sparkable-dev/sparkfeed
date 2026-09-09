import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as Fetch from '../fetch'

const safeFetchText = vi.hoisted(() => vi.fn())
vi.mock('../fetch', async () => {
  const actual = await vi.importActual<typeof Fetch>('../fetch')
  return { ...actual, safeFetchText }
})

const { fetchFeedItems } = await import('../fetch-articles')

function feedXml(pubDate: string) {
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>
    <item><title>Old but good</title><link>https://example.com/a</link>
    <pubDate>${pubDate}</pubDate></item></channel></rss>`
}

beforeEach(() => safeFetchText.mockReset())

/**
 * The Discover preview windowed to 30 days and Y Combinator, which posts every
 * couple of months, rendered "Nothing published recently" — a healthy feed that
 * looked dead and could not be judged at all. Two of the first seventeen feeds
 * opened hit it. The preview now passes no window; ingest also keeps old items, bounded by count rather than publication age.
 */
describe('fetchFeedItems windowing', () => {
  it('keeps items of any age when no window is given', async () => {
    safeFetchText.mockResolvedValue({
      res: { ok: true },
      text: feedXml('Tue, 16 Jun 2026 16:14:22 GMT'),
      contentType: 'application/xml',
      finalUrl: 'u',
    })
    const items = await fetchFeedItems('https://example.com/feed')
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('Old but good')
  })

  it('honors an explicit caller-requested date window', async () => {
    safeFetchText.mockResolvedValue({
      res: { ok: true },
      text: feedXml('Tue, 16 Jun 2026 16:14:22 GMT'),
      contentType: 'application/xml',
      finalUrl: 'u',
    })
    vi.setSystemTime(new Date('2026-08-05T00:00:00Z'))
    const items = await fetchFeedItems('https://example.com/feed', { withinDays: 30 })
    vi.useRealTimers()
    expect(items).toHaveLength(0)
  })
})
