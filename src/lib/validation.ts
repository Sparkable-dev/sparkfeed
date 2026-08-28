import { z } from 'zod'

/**
 * Normalizes what people actually paste into the feed URL box: stray
 * whitespace, a missing scheme ("openai.com"), a trailing "feed url:" style
 * prefix is out of scope but bare hostnames are not.
 *
 * Returns null when the input cannot be made into an http(s) URL.
 */
export function normalizeFeedUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  // Reject anything with an explicit non-http scheme before we prepend one.
  const schemeMatch = trimmed.match(/^([a-z][a-z0-9+.-]*):/i)
  if (schemeMatch && !/^https?$/i.test(schemeMatch[1])) return null

  const candidate = schemeMatch ? trimmed : `https://${trimmed}`

  try {
    const url = new URL(candidate)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (!url.hostname || !url.hostname.includes('.')) return null
    return url.href
  } catch {
    return null
  }
}

/**
 * One feed URL reduced to the thing that decides whether two of them are the
 * same subscription.
 *
 * This exists because three different places used to answer that question three
 * different ways, and two of them contradicted each other: `verify_feed` said
 * "already subscribed" using a normalised comparison, while the insert checked
 * for an exact string match — so the app could tell you a feed was already
 * there and then add it a second time.
 *
 * Scheme and trailing slashes are dropped. `www.` deliberately is not: it
 * almost always identifies the same feed, but collapsing it changes the answer
 * for subscriptions that already exist, and that is a migration rather than a
 * normalisation.
 */
export function feedUrlKey(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
}

/**
 * Shared feed URL validator. Accepts bare hostnames and normalizes them, which
 * the previous inline `z.string().url()` rejected even though feed detection
 * supported them.
 */
export const feedUrlSchema = z
  .string()
  .min(1, 'Feed URL is required')
  .transform((v, ctx) => {
    const normalized = normalizeFeedUrl(v)
    if (!normalized) {
      ctx.addIssue({
        code: 'custom',
        message: 'Enter a valid http or https URL, for example https://openai.com/news',
      })
      return z.NEVER
    }
    return normalized
  })
