export const FEED_REFRESH_AFTER_MS = 60 * 60 * 1000

export interface FeedFreshness {
  lastFetchedAt?: string | null
  lastErrorAt?: string | null
  entitlementPausedAt?: string | null
}

/** Failed attempts also back off for an hour, without pretending they succeeded. */
export function feedNeedsRefresh(
  feed: FeedFreshness,
  now = Date.now()
): boolean {
  if (feed.entitlementPausedAt) return false
  const timestamps = [feed.lastFetchedAt, feed.lastErrorAt]
    .map((value) => (value ? Date.parse(value) : NaN))
    .filter(Number.isFinite)
  return (
    timestamps.length === 0 ||
    now - Math.max(...timestamps) > FEED_REFRESH_AFTER_MS
  )
}
