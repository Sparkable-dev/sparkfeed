import { describe, expect, it } from 'vitest'
import { feedUrlKey, feedUrlSchema, normalizeFeedUrl } from '../validation'

describe('normalizeFeedUrl', () => {
  it('adds https to bare hostnames', () => {
    expect(normalizeFeedUrl('openai.com')).toBe('https://openai.com/')
    expect(normalizeFeedUrl('openai.com/news')).toBe('https://openai.com/news')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeFeedUrl('  https://openai.com/news  ')).toBe('https://openai.com/news')
  })

  it('preserves an explicit http scheme', () => {
    expect(normalizeFeedUrl('http://example.com/rss.xml')).toBe('http://example.com/rss.xml')
  })

  it('rejects non-http schemes rather than prefixing them', () => {
    expect(normalizeFeedUrl('ftp://example.com/feed')).toBeNull()
    expect(normalizeFeedUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeFeedUrl('file:///etc/passwd')).toBeNull()
  })

  it('rejects empty and dotless hosts', () => {
    expect(normalizeFeedUrl('')).toBeNull()
    expect(normalizeFeedUrl('   ')).toBeNull()
    expect(normalizeFeedUrl('localhost')).toBeNull()
  })
})

describe('feedUrlKey', () => {
  it('collapses the differences that do not make a different subscription', () => {
    // This is the bug it exists to fix: the app used to say "already
    // subscribed" using a normalised comparison and then insert on an exact
    // string match, so the same feed could be added twice.
    const key = feedUrlKey('https://example.com/feed')
    expect(feedUrlKey('http://example.com/feed')).toBe(key)
    expect(feedUrlKey('https://example.com/feed/')).toBe(key)
    expect(feedUrlKey('  HTTPS://Example.com/feed//  ')).toBe(key)
  })

  it('keeps www. distinct, deliberately', () => {
    // It almost always identifies the same feed, but collapsing it changes the
    // answer for subscriptions that already exist — that is a migration, not a
    // normalisation, and not this change.
    expect(feedUrlKey('https://www.example.com/feed')).not.toBe(
      feedUrlKey('https://example.com/feed'),
    )
  })

  it('keeps genuinely different paths and query strings apart', () => {
    expect(feedUrlKey('https://example.com/feed')).not.toBe(
      feedUrlKey('https://example.com/comments/feed'),
    )
    expect(feedUrlKey('https://example.com/?feed=rss2')).not.toBe(
      feedUrlKey('https://example.com/?feed=comments-rss2'),
    )
  })
})

describe('feedUrlSchema', () => {
  it('normalizes on parse', () => {
    expect(feedUrlSchema.parse('openai.com/news')).toBe('https://openai.com/news')
  })

  it('fails with a readable message', () => {
    const result = feedUrlSchema.safeParse('nonsense')
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('valid http')
    }
  })
})
