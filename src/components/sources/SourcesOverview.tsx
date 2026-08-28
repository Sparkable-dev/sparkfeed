import { SourceQuadrant } from "./SourceQuadrant"
import { STATUS_STYLE } from "./SourceRows"
import { WINDOW_DAYS } from "./source-stats"
import type { SourcesOverview as Overview } from "./source-stats"
import type { SourceStatus } from "@/lib/source-health"
import { SparkChart } from "@/components/ai/charts/SparkChart"
import { CHART_ACCENT } from "@/components/ai/tools/ChartCard"

/**
 * The state of the collection, above the list of it.
 *
 * The table answers "what do I have and in what order". It cannot answer "is
 * any of this still working", because that only shows up in aggregate: one
 * amber dot in a list of forty is invisible, and nothing in a sorted list tells
 * you that most of your reading comes from a single folder.
 *
 * Three panels, no more. This is a strip you glance at on the way to the table,
 * and the table is what the page is for — if this needed scrolling past it
 * would be the wrong feature.
 *
 * Everything here is folded out of data the page already loaded. See
 * `source-stats.ts`.
 */

/** Left to right, worst last, so the meter reads as a spectrum. */
const METER_ORDER: Array<SourceStatus> = ["active", "new", "quiet", "broken"]

const STATUS_WORD: Record<SourceStatus, string> = {
  active: "active",
  new: "just added",
  quiet: "quiet",
  broken: "not fetching",
}

export function SourcesOverview({ overview }: { overview: Overview }) {
  const { feedCount, folderCount, posts30d, byStatus, byFolder, points } = overview

  const perDay = posts30d / WINDOW_DAYS
  const attention = byStatus.broken + byStatus.quiet

  return (
    <section
      aria-label="Overview"
      className="grid min-w-0 gap-5 rounded-2xl border border-white/[0.07] bg-white/[0.02]
        p-4 sm:grid-cols-2 lg:grid-cols-12"
    >
      {/* ── The numbers ──────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-col gap-3 lg:col-span-3">
        <div className="min-w-0">
          <p className="text-2xl leading-none font-bold tracking-tight text-zinc-50 tabular-nums">
            {feedCount}
            <span className="ml-1.5 text-sm font-medium text-zinc-500">
              {feedCount === 1 ? "source" : "sources"}
            </span>
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            {folderCount === 0
              ? "not in any folder yet"
              : `across ${folderCount} ${folderCount === 1 ? "folder" : "folders"}`}
            {attention > 0 && (
              <>
                {" · "}
                <span className="text-amber-400/80">
                  {attention} {attention === 1 ? "needs" : "need"} a look
                </span>
              </>
            )}
          </p>
        </div>

        <StatusMeter byStatus={byStatus} total={feedCount} />
      </div>

      {/* ── Where the volume comes from ──────────────────────────────── */}
      <div className="flex min-w-0 flex-col gap-2 lg:col-span-4">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-xs font-semibold text-zinc-300">Posts by folder</h3>
          {/*
            The total and the rate, because a bar chart of shares says nothing
            about scale — 90% of eleven posts and 90% of nine thousand look
            identical.
          */}
          <span className="text-[10px] text-zinc-600 tabular-nums">
            {posts30d.toLocaleString()} in {WINDOW_DAYS}d
            {posts30d > 0 && ` · ~${perDay < 1 ? perDay.toFixed(1) : Math.round(perDay)}/day`}
          </span>
        </div>
        <SparkChart
          shape="bars"
          points={byFolder}
          accent={CHART_ACCENT}
          className="text-zinc-400"
        />
      </div>

      {/*
        Hidden on a phone rather than stacked. A scatter is read by comparing
        positions, and at 320px the whole plot is narrower than the four labels
        that explain it. What it says — which sources have stopped — is already
        in the table as the amber "need a look" counts, so nothing is only
        available here.
      */}
      <div className="hidden min-w-0 lg:col-span-5 lg:flex lg:flex-col">
        <SourceQuadrant points={points} />
      </div>
    </section>
  )
}

/**
 * One bar for the whole collection, then the words.
 *
 * A stacked meter rather than four separate counts: the question is what
 * proportion of the workspace is still working, and a proportion is the one
 * thing a row of numbers makes you compute yourself.
 */
function StatusMeter({
  byStatus,
  total,
}: {
  byStatus: Record<SourceStatus, number>
  total: number
}) {
  const present = METER_ORDER.filter((status) => byStatus[status] > 0)

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {/*
        No gaps between the segments. Their widths already add to 100%, so any
        gutter has to come out of the last one — which is the broken count, the
        one segment that must not be the one that gets clipped.
      */}
      <div
        className="flex h-1.5 w-full overflow-hidden rounded-full"
        role="img"
        aria-label={present
          .map((status) => `${byStatus[status]} ${STATUS_WORD[status]}`)
          .join(", ")}
      >
        {present.map((status) => (
          <span
            key={status}
            className={`h-full ${STATUS_STYLE[status].dot}`}
            style={{ width: `${(byStatus[status] / Math.max(1, total)) * 100}%` }}
          />
        ))}
      </div>

      <ul className="flex min-w-0 flex-wrap gap-x-3 gap-y-1">
        {present.map((status) => (
          <li key={status} className="flex items-center gap-1.5 text-[11px] text-zinc-500">
            <span
              aria-hidden="true"
              className={`size-1.5 shrink-0 rounded-full ${STATUS_STYLE[status].dot}`}
            />
            <span className="tabular-nums">{byStatus[status]}</span>
            {STATUS_WORD[status]}
          </li>
        ))}
      </ul>
    </div>
  )
}
