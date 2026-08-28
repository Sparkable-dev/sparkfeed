import { describe, expect, it } from 'vitest'
import { safeParseDate } from '../dates'
import { feedImageOf, selectFreshItems } from '../fetch-articles'

describe('selectFreshItems', () => {
  it('skips links already in the database', () => {
    const items = [{ link: 'a' }, { link: 'b' }]
    expect(selectFreshItems(items, new Set(['a']))).toEqual([{ link: 'b' }])
  })

  // The regression: filtering only against stored links let a feed listing the
  // same URL twice insert it twice, because both copies passed the check before
  // either was written. 32 of 300 demo articles were duplicates this way.
  it('skips repeats within the same batch', () => {
    const items = [{ link: 'a' }, { link: 'a' }, { link: 'b' }]
    expect(selectFreshItems(items, new Set())).toEqual([{ link: 'a' }, { link: 'b' }])
  })

  it('keeps the first occurrence, which is the newest in feed order', () => {
    const items = [
      { link: 'a', title: 'updated' },
      { link: 'a', title: 'original' },
    ]
    expect(selectFreshItems(items, new Set())).toEqual([{ link: 'a', title: 'updated' }])
  })

  it('passes everything through when nothing collides', () => {
    const items = [{ link: 'a' }, { link: 'b' }]
    expect(selectFreshItems(items, new Set())).toHaveLength(2)
  })
})

describe('safeParseDate', () => {
  it('parses RFC 822 pubDate values', () => {
    expect(safeParseDate('Wed, 02 Oct 2024 15:00:00 GMT')).toBe('2024-10-02T15:00:00.000Z')
  })

  it('parses ISO dates', () => {
    expect(safeParseDate('2024-10-02T15:00:00.000Z')).toBe('2024-10-02T15:00:00.000Z')
  })

  it('returns null instead of throwing on malformed dates', () => {
    // new Date(x).toISOString() throws RangeError on these, which used to abort
    // the entire ingest run partway through a feed.
    expect(safeParseDate('not a date')).toBeNull()
    expect(safeParseDate('0000-00-00')).toBeNull()
    expect(safeParseDate('')).toBeNull()
    expect(safeParseDate(undefined)).toBeNull()
    expect(safeParseDate(null)).toBeNull()
  })
})

/**
 * `feedImageOf` was split out of `findImage` so the Discover preview could get
 * an image without making 40 extra HTTP requests. The dangerous version of that
 * refactor is the one where ingest starts using it *instead of* the og:image
 * scrape — every article card in the product would quietly fall back to whatever
 * generic logo the feed ships, and nothing would fail.
 *
 * These lock the fallback order. That `findImage` still tries the network first
 * is asserted by reading it; what is worth pinning here is that this function
 * never reaches out, and that its precedence is the one ingest relied on.
 */
describe('feedImageOf', () => {
  it('prefers media:content, the full-size asset', () => {
    expect(
      feedImageOf({
        mediaContent: { $: { url: 'full.jpg' } },
        mediaThumbnail: { $: { url: 'thumb.jpg' } },
        itunes: { image: 'itunes.jpg' },
      }),
    ).toBe('full.jpg')
  })

  it('takes an enclosure only when it is actually an image', () => {
    expect(feedImageOf({ enclosure: { url: 'a.mp3', type: 'audio/mpeg' } })).toBeNull()
    expect(feedImageOf({ enclosure: { url: 'a.jpg', type: 'image/jpeg' } })).toBe('a.jpg')
  })

  it('falls back to the thumbnail last', () => {
    expect(feedImageOf({ mediaThumbnail: { $: { url: 'thumb.jpg' } } })).toBe('thumb.jpg')
  })

  it('returns null rather than guessing', () => {
    expect(feedImageOf({ link: 'https://example.com/post' })).toBeNull()
  })
})
