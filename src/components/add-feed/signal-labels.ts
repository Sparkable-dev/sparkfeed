import type { FeedSignalCode, FeedSignals } from "@/server/utils/feed-signals"

/**
 * Signals turned into the one muted line under a feed's name.
 *
 * No chips, no badges, no per-row borders. The first version of this dialog
 * decorated every fact — a pill for "MAIN", a pill for the item count, a
 * separate URL line — and the verdict was that it looked cluttered. So a row is
 * two lines: the name, and a single sentence of facts separated by middots,
 * where a problem is simply the first of them and coloured.
 *
 * Pure, so the wording and the ordering can be tested without rendering.
 */

export type Tone = "warn" | "muted"

export interface SignalLabel {
  /** React key. Not meaningful beyond being unique within a row. */
  key: string
  text: string
  tone: Tone
  /** Longer explanation, shown on hover. */
  title?: string
}

const LABELS: Record<FeedSignalCode, Omit<SignalLabel, "key">> = {
  no_items: {
    text: "Empty",
    tone: "warn",
    title: "This parses as a feed but has no articles in it yet.",
  },
  comments_feed: {
    text: "Comments",
    tone: "warn",
    title:
      "A feed of reader comments rather than posts. Sites advertise these alongside the real feed.",
  },
  quiet: { text: "Quiet", tone: "warn", title: "Nothing published in a long time." },
  summary_only: {
    text: "Summaries",
    tone: "muted",
    title: "Items carry excerpts rather than whole articles.",
  },
  insecure: { text: "Not secure", tone: "muted", title: "Served over plain http." },
  redirected: {
    text: "Redirected",
    tone: "muted",
    title: "The address you gave sends us somewhere else. We will use the destination.",
  },
}

/**
 * "5 a week", "0.4 a week", or nothing.
 *
 * Nothing also covers a rate that rounds to zero. `readCadence` reports one
 * decimal below 1, so a blog posting every few months comes out as 0 — and
 * "0 a week" beside a post from last month is not a rounding artefact the
 * reader should have to see through. The last-post date says it better.
 */
export function cadenceLabel(postsPerWeek: number | null): string | null {
  if (postsPerWeek === null || postsPerWeek === 0) return null
  return `${postsPerWeek} a week`
}

/** "today", "3d ago", "8 Mar 2023". Coarse on purpose — this is a rhythm. */
export function lastPostLabel(signals: FeedSignals): string | null {
  const { daysSinceLastPost, lastPublishedAt } = signals
  if (daysSinceLastPost === null || !lastPublishedAt) return null
  if (daysSinceLastPost === 0) return "today"
  if (daysSinceLastPost < 30) return `${daysSinceLastPost}d ago`

  // Past a month, a relative number stops meaning anything and a date starts
  // meaning a lot: "nothing since Mar 2023" is the whole argument against
  // subscribing.
  return new Date(lastPublishedAt).toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  })
}

/**
 * The facts, worst first.
 *
 * `alreadyAdded` leads everything: if you already have it, nothing else about
 * it is a decision you are making.
 */
export function signalLabels(
  signals: FeedSignals,
  alreadyAdded: boolean,
): Array<SignalLabel> {
  if (alreadyAdded) {
    return [{ key: "already_added", text: "Already added", tone: "muted" }]
  }
  return signals.codes.map((code) => ({ key: code, ...LABELS[code] }))
}

/**
 * The whole meta line as ordered parts.
 *
 * Capped, because a feed can legitimately trip four signals at once and a row
 * that wraps to three lines is the clutter this replaced. What falls off is
 * still reachable: the caller puts the full list in a `title`.
 */
export function metaParts(
  signals: FeedSignals,
  alreadyAdded: boolean,
  limit = 3,
): { parts: Array<SignalLabel>; hidden: Array<SignalLabel> } {
  const flags = signalLabels(signals, alreadyAdded)

  const facts: Array<SignalLabel> = []
  if (!alreadyAdded) {
    const quiet = signals.codes.includes("quiet")

    // A dormant feed's historical rate is not a fact anyone wants: "0.1 a week"
    // beside "Quiet" invites the reader to work out that it stopped, when the
    // date says so directly.
    const cadence = quiet ? null : cadenceLabel(signals.postsPerWeek)
    if (cadence) facts.push({ key: "cadence", text: cadence, tone: "muted" })

    const last = lastPostLabel(signals)
    if (last) {
      // A quiet feed's date is the whole argument, so it gets said in full:
      // "Quiet · nothing since Mar 2023" rather than a bare month.
      facts.push({
        key: "last",
        text: quiet ? `nothing since ${last}` : last,
        tone: "muted",
      })
    }
    if (signals.fullText === "full") {
      facts.push({ key: "fulltext", text: "full text", tone: "muted" })
    }
  }

  // Warnings first, then the neutral facts, then the quieter notes.
  const warnings = flags.filter((f) => f.tone === "warn")
  const notes = flags.filter((f) => f.tone !== "warn")
  const all = [...warnings, ...facts, ...notes]

  return { parts: all.slice(0, limit), hidden: all.slice(limit) }
}

/** The path of a feed URL, for telling two section feeds apart. */
export function feedPath(url: string): string | null {
  try {
    const { pathname, search } = new URL(url)
    const path = `${pathname}${search}`
    return path === "/" ? null : path
  } catch {
    return null
  }
}
