/**
 * Parses a date string from a feed.
 *
 * Feeds ship all sorts of malformed dates, and `new Date(x).toISOString()`
 * throws RangeError on them, which used to abort an entire ingest run partway
 * through a feed.
 */
export function safeParseDate(raw: string | undefined | null): string | null {
  if (!raw || raw.length > 512) return null
  let value = raw.trim()
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[Tt ]|$)/)
  if (iso) {
    const [, y, m, day] = iso
    const year = Number(y),
      month = Number(m),
      date = Number(day)
    if (
      month < 1 ||
      month > 12 ||
      date < 1 ||
      date > new Date(Date.UTC(year, month, 0)).getUTCDate()
    )
      return null
    // Missing zones must not depend on the server's local timezone.
    if (value.length > 10 && !/(?:z|[+-]\d{2}:?\d{2})$/i.test(value))
      value += "Z"
  } else if (!/[a-z]{3}/i.test(value)) return null
  else if (/^[A-Za-z]{3,9} \d{1,2},? \d{4}$/.test(value)) value += " UTC"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}
