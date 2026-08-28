/**
 * Relative time, to the coarsest unit that still says something useful.
 *
 * Past a month the elapsed count stops being informative — "47d ago" makes you
 * do arithmetic — so it degrades to a plain month/year.
 */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "Never"
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return "Never"

  const mins = Math.floor((Date.now() - then) / 60000)
  if (mins < 1) return "Just now"
  if (mins < 60) return `${mins}m ago`

  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`

  return new Date(iso).toLocaleDateString(undefined, { month: "short", year: "numeric" })
}
