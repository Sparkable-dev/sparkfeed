/**
 * The fields these rules actually read.
 *
 * Structural rather than `HomeSource`, because /sources builds its own row from
 * a leaner query and there is no reason both callers should have to carry the
 * dashboard's shape to ask whether a feed has gone quiet.
 */
export interface HealthInput {
  /** Posts in the last 30 days. */
  posts30d: number
  /** Oldest and newest post inside that window. */
  firstAt30d: string | null
  lastAt30d: string | null
  /** Newest post ever, so a source quiet for months still reports one. */
  lastPostAt: string | null
  /** Set only when the most recent fetch failed; cleared on success. */
  lastError: string | null
  createdAt: string | null
}

/**
 * How a source is doing, derived rather than stored.
 *
 * Nothing in the product surfaces a source that has stopped working. A feed
 * that 404s keeps its place in the sidebar and simply stops producing, which
 * is indistinguishable from a publisher taking a week off unless someone opens
 * the manage modal. These four states exist to tell those apart.
 */
export type SourceStatus = "broken" | "quiet" | "new" | "active"

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Below this there is no interval to speak of, only two dates. */
const MIN_POSTS_FOR_INTERVAL = 3

/** A source younger than this has no publishing record worth reporting. */
const SETTLING_IN_MS = 7 * DAY

/** Silence is only notable once it is both relatively and absolutely long. */
const QUIET_MULTIPLE = 3
const QUIET_FLOOR_MS = 2 * DAY

/**
 * The typical wait between posts, in milliseconds, or null if unknowable.
 *
 * Mean rather than median: a median needs the individual gaps, which means
 * pulling every article's timestamp per feed, where the mean falls out of the
 * count and the two endpoints the aggregate query already returns. The mean's
 * weakness is that a burst of twenty posts followed by silence still reads as
 * "every 4h" — which is exactly why the UI shows the last post beside it. The
 * pair is honest where either number alone is not.
 */
export function typicalGapMs(source: HealthInput): number | null {
  if (source.posts30d < MIN_POSTS_FOR_INTERVAL) return null
  if (!source.firstAt30d || !source.lastAt30d) return null

  const span = Date.parse(source.lastAt30d) - Date.parse(source.firstAt30d)
  if (!Number.isFinite(span) || span <= 0) return null

  return span / (source.posts30d - 1)
}

export function sourceStatus(source: HealthInput, now = Date.now()): SourceStatus {
  // `lastError` is cleared on every successful fetch, so a value here means the
  // most recent attempt failed rather than that one ever did.
  if (source.lastError) return "broken"

  const gap = typicalGapMs(source)
  const added = source.createdAt ? Date.parse(source.createdAt) : NaN
  const isNew = Number.isFinite(added) && now - added < SETTLING_IN_MS

  if (!source.lastPostAt) return isNew ? "new" : "quiet"

  const silence = now - Date.parse(source.lastPostAt)
  if (!Number.isFinite(silence)) return "active"

  if (gap === null) {
    // Too little history to say what normal looks like. Only a month of
    // nothing is unambiguous enough to call.
    if (isNew) return "new"
    return silence > 30 * DAY ? "quiet" : "active"
  }

  return silence > Math.max(gap * QUIET_MULTIPLE, QUIET_FLOOR_MS) ? "quiet" : "active"
}

/** "every 8h", "every 6d". Coarse on purpose: this is a rhythm, not a metric. */
export function formatGap(ms: number | null): string | null {
  if (ms === null) return null
  if (ms < HOUR) return `every ${Math.max(1, Math.round(ms / MINUTE))}m`
  if (ms < DAY) return `every ${Math.round(ms / HOUR)}h`
  return `every ${Math.round(ms / DAY)}d`
}

/** Whole days of silence, for the "quiet for 41 days" line. */
export function daysSince(iso: string | null, now = Date.now()): number | null {
  if (!iso) return null
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return null
  return Math.floor((now - then) / DAY)
}
