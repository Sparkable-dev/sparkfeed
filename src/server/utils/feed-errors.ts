/**
 * Turns whatever went wrong internally into something safe and useful to show a
 * person. Nothing from a driver, parser or stack trace reaches the client:
 * beta once rendered a raw Drizzle "Failed query: select ..." string at the
 * user, which is both alarming and useless to them.
 */
import { BlockedUrlError, ResponseTooLargeError } from './fetch'

export type FeedErrorCode =
  | 'invalid_url'
  | 'blocked_url'
  | 'unreachable'
  | 'timeout'
  | 'too_large'
  | 'not_a_feed'
  | 'no_items'
  | 'duplicate'
  | 'not_found'
  | 'demo_locked'
  | 'internal'

export type FeedError = { code: FeedErrorCode; message: string }

const MESSAGES: Record<FeedErrorCode, string> = {
  invalid_url: 'That does not look like a valid web address.',
  blocked_url: 'That address is not reachable from Sparkfeed.',
  unreachable: 'We could not reach that site. Check the address and try again.',
  timeout: 'That site took too long to respond. Try again in a moment.',
  too_large: 'That feed is too large to import.',
  not_a_feed: 'No RSS or Atom feed found at that address.',
  no_items: 'That feed is valid but has no recent articles.',
  duplicate: 'You have already added this feed.',
  // Deliberately does not distinguish "deleted" from "belongs to someone else":
  // telling them apart would confirm which feed ids exist.
  not_found: 'That feed no longer exists.',
  demo_locked: 'This feature is locked in demo mode.',
  internal: 'Something went wrong on our side. Please try again.',
}

export function feedError(code: FeedErrorCode, message?: string): FeedError {
  return { code, message: message ?? MESSAGES[code] }
}

const NETWORK_CODES = new Set([
  'ENOTFOUND',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EAI_AGAIN',
  'CERT_HAS_EXPIRED',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
])

/** Classifies an unknown thrown value. Never echoes its message. */
export function toFeedError(err: unknown): FeedError {
  if (err instanceof BlockedUrlError) return feedError('blocked_url', err.message)
  if (err instanceof ResponseTooLargeError) return feedError('too_large')

  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return feedError('timeout')

    const cause = (err as Error & { cause?: { code?: string } }).cause
    const code = cause?.code ?? (err as Error & { code?: string }).code
    if (code && NETWORK_CODES.has(code)) return feedError('unreachable')
    if (err.name === 'TypeError' && err.message.includes('fetch')) return feedError('unreachable')

    // rss-parser and the xml2js sax parser underneath it.
    if (
      err.message.includes('Feed not recognized') ||
      err.message.includes('Non-whitespace before first tag') ||
      err.message.includes('Unexpected close tag') ||
      err.message.includes('Unclosed root tag') ||
      err.message.includes('Expected a feed but got')
    ) {
      return feedError('not_a_feed')
    }
  }

  return feedError('internal')
}
