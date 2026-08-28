/**
 * Parses a date string from a feed.
 *
 * Feeds ship all sorts of malformed dates, and `new Date(x).toISOString()`
 * throws RangeError on them, which used to abort an entire ingest run partway
 * through a feed.
 */
export function safeParseDate(raw: string | undefined | null): string | null {
  if (!raw) return null
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}
