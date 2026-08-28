/**
 * Per-key request throttling.
 *
 * In-memory token buckets. This is correct at one Railway replica, which is
 * what the app runs today; with more than one the effective limit multiplies by
 * the replica count. The upgrade path is an `api_key_usage` table with
 * `INSERT ... ON CONFLICT DO UPDATE` on a per-minute bucket key, which needs no
 * new infrastructure.
 *
 * Agents poll far harder than humans, so this exists from day one rather than
 * after the first incident.
 */

const WINDOW_MS = 60_000
const DEFAULT_MAX = 120
/** The demo key is shared by everyone, so it gets a tighter global ceiling. */
const DEMO_MAX = 60

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

/** Stops the map growing without bound when keys rotate or demo IPs churn. */
function sweep(now: number) {
  if (buckets.size < 1000) return
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}

export interface RateLimitResult {
  ok: boolean
  retryAfterMs: number
}

export function checkRateLimit(key: string, opts: { demo?: boolean } = {}): RateLimitResult {
  const now = Date.now()
  sweep(now)

  const max = opts.demo ? DEMO_MAX : DEFAULT_MAX
  const bucket = buckets.get(key)

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return { ok: true, retryAfterMs: 0 }
  }

  if (bucket.count >= max) {
    return { ok: false, retryAfterMs: Math.max(bucket.resetAt - now, 0) }
  }

  bucket.count += 1
  return { ok: true, retryAfterMs: 0 }
}

/**
 * The client address, for limiting the shared demo key per-visitor rather than
 * globally.
 *
 * Takes the *last* `x-forwarded-for` hop, the one the trusted proxy appended.
 * The first entry is client-supplied and trivially spoofed.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const hops = forwarded.split(',').map((h) => h.trim()).filter(Boolean)
    if (hops.length) return hops[hops.length - 1]
  }
  return request.headers.get('x-real-ip') ?? 'unknown'
}
