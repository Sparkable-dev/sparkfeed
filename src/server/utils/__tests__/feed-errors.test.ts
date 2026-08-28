import { describe, expect, it } from 'vitest'
import { feedError, toFeedError } from '../feed-errors'
import { BlockedUrlError, ResponseTooLargeError } from '../fetch'

describe('toFeedError', () => {
  it('classifies blocked addresses', () => {
    expect(toFeedError(new BlockedUrlError('nope')).code).toBe('blocked_url')
  })

  it('classifies oversized responses', () => {
    expect(toFeedError(new ResponseTooLargeError(1024)).code).toBe('too_large')
  })

  it('classifies timeouts', () => {
    const err = new Error('The operation was aborted due to timeout')
    err.name = 'TimeoutError'
    expect(toFeedError(err).code).toBe('timeout')
  })

  it('classifies DNS and connection failures', () => {
    const err = new Error('fetch failed')
    ;(err as Error & { cause?: { code: string } }).cause = { code: 'ENOTFOUND' }
    expect(toFeedError(err).code).toBe('unreachable')
  })

  it('classifies rss-parser rejections as not_a_feed', () => {
    expect(toFeedError(new Error('Feed not recognized as RSS 1 or 2.')).code).toBe('not_a_feed')
    expect(toFeedError(new Error('Non-whitespace before first tag.')).code).toBe('not_a_feed')
  })

  it('falls back to internal for anything unrecognised', () => {
    expect(toFeedError(new Error('kaboom')).code).toBe('internal')
    expect(toFeedError('a string').code).toBe('internal')
    expect(toFeedError(null).code).toBe('internal')
  })

  it('never leaks SQL or driver text into the user-facing message', () => {
    const drizzleish = new Error(
      'Failed query: select "id", "content" from "articles" where "articles"."feed_id" in ($1)',
    )
    const mapped = toFeedError(drizzleish)
    expect(mapped.code).toBe('internal')
    expect(mapped.message).not.toContain('select')
    expect(mapped.message).not.toContain('articles')
    expect(mapped.message).toBe('Something went wrong on our side. Please try again.')
  })

  it('produces a message for every code', () => {
    const codes = [
      'invalid_url',
      'blocked_url',
      'unreachable',
      'timeout',
      'too_large',
      'not_a_feed',
      'no_items',
      'duplicate',
      'not_found',
      'demo_locked',
      'internal',
    ] as const
    for (const code of codes) {
      expect(feedError(code).message.length).toBeGreaterThan(0)
    }
  })
})
