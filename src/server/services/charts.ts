import { articleCountsByFolder, articleStatsByFeed, articlesPerDay } from "./stats"
import { listFeeds, listFolders  } from "./workspace"
import { invalidArgument } from "./errors"
import type { ApiPrincipal } from "../api/principal"
import { UNFILED_LABEL } from "@/lib/unfiled"

/**
 * Numbers shaped for a chart.
 *
 * A fixed menu of metrics rather than a query language. The model picks one of
 * four; it does not describe a chart. That is the whole safety story here — a
 * free-form "chart this" would need the model to generate SQL or to be handed
 * enough raw rows to build a series from, and both are worse than four names.
 *
 * It also means every chart in the product is one someone chose to support, so
 * each has a real title, a real unit, and an answer to "what does this tell
 * me". A chart nobody designed is a chart nobody reads.
 */

export const CHART_METRICS = [
  "articles_over_time",
  "unread_by_folder",
  "top_sources",
  "posting_cadence",
] as const

export type ChartMetric = (typeof CHART_METRICS)[number]

export interface ChartPoint {
  label: string
  value: number
}

export interface ChartResult {
  metric: ChartMetric
  title: string
  /** What one unit on the value axis means, for the axis label and the card. */
  unit: string
  /** `series` for a time series, `bars` for a ranking. Decides the mark. */
  shape: "series" | "bars"
  points: Array<ChartPoint>
  /** Headline figure, pre-formatted, shown above the chart. */
  total: string
  /** Change against the previous window of the same length. Null when there is none. */
  delta: string | null
  /** One line the model can say out loud, so the chart is not the whole answer. */
  summary: string
}

export interface ChartArgs {
  metric: ChartMetric
  /** Days of history for the time-based metrics. Ignored by the rankings. */
  days?: number
  limit?: number
}

export async function buildChart(
  principal: ApiPrincipal,
  args: ChartArgs
): Promise<ChartResult> {
  const days = Math.min(Math.max(Math.round(args.days ?? 30), 2), 365)
  const limit = Math.min(Math.max(Math.round(args.limit ?? 8), 1), 20)

  switch (args.metric) {
    case "articles_over_time":
      return await articlesOverTime(principal, days)
    case "posting_cadence":
      return await postingCadence(principal, days)
    case "unread_by_folder":
      return await unreadByFolder(principal, limit)
    case "top_sources":
      return await topSources(principal, limit)
    default:
      throw invalidArgument(
        `Unknown metric. Choose one of: ${CHART_METRICS.join(", ")}.`
      )
  }
}

async function articlesOverTime(
  principal: ApiPrincipal,
  days: number
): Promise<ChartResult> {
  const buckets = await articlesPerDay(principal, { days })
  const total = buckets.reduce((sum, b) => sum + b.count, 0)

  /*
    Compared against the immediately preceding window of the same length, which
    is the only comparison that does not need a second query. Halving the window
    to do it means a 30-day chart reports "last 15 vs the 15 before" — stated in
    the summary rather than left for the reader to assume it means something
    else.
  */
  const half = Math.floor(buckets.length / 2)
  const recent = buckets.slice(half).reduce((s, b) => s + b.count, 0)
  const previous = buckets.slice(0, half).reduce((s, b) => s + b.count, 0)

  return {
    metric: "articles_over_time",
    title: `Articles per day, last ${days} days`,
    unit: "articles",
    shape: "series",
    points: buckets.map((b) => ({ label: b.date, value: b.count })),
    total: `${total.toLocaleString()}`,
    delta: percentDelta(recent, previous),
    summary: `${total.toLocaleString()} articles arrived in the last ${days} days, about ${Math.round(total / days)} a day.`,
  }
}

async function postingCadence(
  principal: ApiPrincipal,
  days: number
): Promise<ChartResult> {
  const buckets = await articlesPerDay(principal, { days })

  // Day-of-week totals answer "when does my reading pile up", which the raw
  // series cannot: a weekly rhythm is invisible in 30 consecutive bars.
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  const totals = new Array(7).fill(0) as Array<number>
  for (const bucket of buckets) {
    totals[new Date(`${bucket.date}T00:00:00Z`).getUTCDay()] += bucket.count
  }

  const points = names.map((label, index) => ({
    label,
    value: totals[index] ?? 0,
  }))
  const busiest = points.reduce((a, b) => (b.value > a.value ? b : a), points[0])

  return {
    metric: "posting_cadence",
    title: `Articles by day of week, last ${days} days`,
    unit: "articles",
    shape: "bars",
    points,
    total: busiest.label,
    delta: null,
    summary: `${busiest.label} is the busiest day, with ${busiest.value.toLocaleString()} articles over the last ${days} days.`,
  }
}

async function unreadByFolder(
  principal: ApiPrincipal,
  limit: number
): Promise<ChartResult> {
  const [{ folders }, counts] = await Promise.all([
    listFolders(principal),
    articleCountsByFolder(principal),
  ])

  const points = folders
    .map((folder) => ({
      label: folder.name,
      value: folder.unread_count ?? 0,
    }))
    .filter((p) => p.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)

  // Feeds outside any folder are a real bucket, and often the biggest one.
  const ungrouped = counts.get(null)?.unread_count ?? 0
  if (ungrouped > 0) {
    points.push({ label: UNFILED_LABEL, value: ungrouped })
    points.sort((a, b) => b.value - a.value)
  }

  const total = points.reduce((sum, p) => sum + p.value, 0)

  return {
    metric: "unread_by_folder",
    title: "Unread by folder",
    unit: "unread",
    shape: "bars",
    points,
    total: total.toLocaleString(),
    delta: null,
    summary:
      points.length === 0
        ? "Nothing unread anywhere."
        : `${total.toLocaleString()} unread, most of it in ${points[0].label}.`,
  }
}

async function topSources(
  principal: ApiPrincipal,
  limit: number
): Promise<ChartResult> {
  const [{ feeds }, stats] = await Promise.all([
    listFeeds(principal, { limit: 200 }),
    articleStatsByFeed(principal),
  ])

  const points = feeds
    .map((feed) => ({
      label: feed.name,
      // `posts_30d` is the comparable number: total articles just rewards
      // whichever feed has been subscribed longest.
      value: stats.get(stripPrefix(feed.id))?.posts_30d ?? 0,
    }))
    .filter((p) => p.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)

  const total = points.reduce((sum, p) => sum + p.value, 0)

  return {
    metric: "top_sources",
    title: "Busiest feeds, last 30 days",
    unit: "posts",
    shape: "bars",
    points,
    total: total.toLocaleString(),
    delta: null,
    summary:
      points.length === 0
        ? "No feed has posted in the last 30 days."
        : `${points[0].label} posts the most, ${points[0].value} times in 30 days.`,
  }
}

/** Feed ids are prefixed for callers; the stats map is keyed on the raw id. */
function stripPrefix(id: string): string {
  const underscore = id.indexOf("_")
  return underscore === -1 ? id : id.slice(underscore + 1)
}

function percentDelta(recent: number, previous: number): string | null {
  if (previous <= 0) return null
  const change = Math.round(((recent - previous) / previous) * 100)
  if (change === 0) return "level"
  return `${change > 0 ? "+" : ""}${change}%`
}
