import { STATUS_STYLE } from "./SourceRows"
import {
  QUIET_AFTER_DAYS,
  REGULAR_POSTS,
  SILENCE_CAP_DAYS,
  WINDOW_DAYS,
  countByQuadrant,
} from "./source-stats"
import type { Quadrant, SourcePoint } from "./source-stats"

/**
 * Every source at once, on the two axes that say whether it is working.
 *
 * How much a source publishes and how long ago it last did are independent —
 * that is the whole reason this is a plot and not two more numbers. A feed
 * posting four times a day until last Tuesday and a feed that has always
 * posted monthly both read as "quiet" in a list sorted by last post, and only
 * one of them is a problem. Here they land in different corners.
 *
 * Divs rather than SVG. The marks are circles and the box stretches to whatever
 * width the column gets, so any `viewBox` wide enough to fill it would flatten
 * every dot into an ellipse — `preserveAspectRatio` can fix that or fill the
 * space, not both. Percentage offsets have neither problem.
 */

const QUADRANTS: Record<Quadrant, { label: string; hint: string }> = {
  busy: { label: "Busy", hint: "publishing regularly and recently" },
  stalled: { label: "Went quiet", hint: "used to publish often, then stopped" },
  occasional: { label: "Occasional", hint: "posts rarely, but did post recently" },
  dormant: { label: "Dormant", hint: "rare and nothing for a while" },
}

/**
 * Vertical position, on a square-root scale.
 *
 * One news wire posting 400 times against blogs posting five would flatten
 * every other source onto the floor of a linear axis, and the floor is where
 * the interesting distinctions are. The root keeps the ordering exact and only
 * compresses the top, which is the end where "a lot" is the whole message.
 */
function volumeOffset(posts: number, max: number): number {
  if (max <= 0) return 0
  return Math.sqrt(Math.min(posts, max) / max) * 100
}

/** Horizontal position. Never-posted pins to the stale edge. */
function silenceOffset(quietDays: number | null): number {
  if (quietDays === null) return 100
  return (Math.min(quietDays, SILENCE_CAP_DAYS) / SILENCE_CAP_DAYS) * 100
}

export function SourceQuadrant({ points }: { points: Array<SourcePoint> }) {
  const max = Math.max(REGULAR_POSTS, ...points.map((p) => p.posts30d))
  const counts = countByQuadrant(points)

  // The dividers have to sit at the same coordinates as the dots, or a source
  // renders on the opposite side of the line from the corner it is counted in.
  const splitX = silenceOffset(QUIET_AFTER_DAYS)
  const splitY = volumeOffset(REGULAR_POSTS, max)

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold text-zinc-300">Volume against silence</h3>
        <span className="text-[10px] text-zinc-600">last {WINDOW_DAYS} days</span>
      </div>

      {/*
        `role="img"` with the corner counts spelled out. A scatter is a wall of
        positioned spans, and read out one dot at a time it is noise; the four
        counts are the whole of what it says.
      */}
      <div
        role="img"
        aria-label={`${points.length} sources by volume and silence: ${(
          Object.keys(QUADRANTS) as Array<Quadrant>
        )
          .map((quadrant) => `${counts[quadrant]} ${QUADRANTS[quadrant].label.toLowerCase()}`)
          .join(", ")}`}
        className="relative h-32 w-full rounded-lg border border-white/[0.06] bg-black/20"
      >
        {/* Corner labels, each carrying its own count. */}
        <QuadrantLabel
          quadrant="busy"
          count={counts.busy}
          className="top-1.5 left-2"
        />
        <QuadrantLabel
          quadrant="stalled"
          count={counts.stalled}
          className="top-1.5 right-2 text-right"
          alarming
        />
        <QuadrantLabel
          quadrant="occasional"
          count={counts.occasional}
          className="bottom-1.5 left-2"
        />
        <QuadrantLabel
          quadrant="dormant"
          count={counts.dormant}
          className="bottom-1.5 right-2 text-right"
        />

        {/*
          The dots live in a box inset from the labelled one, so the extreme
          positions — which are the common ones, a busy daily feed sits hard in
          the top-left — cannot land underneath a corner label. The dividers are
          inset with them, because a split drawn in different coordinates from
          the marks would put sources on the wrong side of their own line.
        */}
        <div className="absolute inset-x-3 top-5 bottom-4">
          <span
            aria-hidden="true"
            className="absolute inset-y-0 w-px bg-white/[0.09]"
            style={{ left: `${splitX}%` }}
          />
          <span
            aria-hidden="true"
            className="absolute inset-x-0 h-px bg-white/[0.09]"
            style={{ bottom: `${splitY}%` }}
          />

          {points.map((point) => (
            <span
              key={point.id}
              /*
                A real title, so the plot is readable one source at a time.
                There is no room to label ten dots at this size, and the table
                below is already the labelled version of the same data.
              */
              title={`${point.name} — ${point.posts30d} ${
                point.posts30d === 1 ? "post" : "posts"
              }, ${
                point.quietDays === null
                  ? "never posted"
                  : point.quietDays === 0
                    ? "posted today"
                    : `${point.quietDays}d ago`
              }`}
              /*
                The ring is separation, not decoration: sources cluster hard in
                the busy corner, and without it a pile of dots reads as one
                larger blob.
              */
              className={`absolute size-2 -translate-x-1/2 translate-y-1/2 rounded-full
                ring-2 ring-black/70 ${STATUS_STYLE[point.status].dot}`}
              style={{
                left: `${silenceOffset(point.quietDays)}%`,
                bottom: `${volumeOffset(point.posts30d, max)}%`,
              }}
            />
          ))}
        </div>
      </div>

      {/*
        The axes in words. Both thresholds are printed because both are
        judgement calls, and a divider that does not say where it is cannot be
        told apart from one placed to make the picture look tidy.
      */}
      <div className="flex items-center justify-between gap-2 text-[10px] text-zinc-600">
        <span>posted today</span>
        <span className="hidden sm:inline">
          splits at {QUIET_AFTER_DAYS} days and {REGULAR_POSTS} posts
        </span>
        <span>{SILENCE_CAP_DAYS}+ days ago</span>
      </div>
    </div>
  )
}

function QuadrantLabel({
  quadrant,
  count,
  className,
  alarming,
}: {
  quadrant: Quadrant
  count: number
  className: string
  /** The corner worth acting on, coloured only when something is in it. */
  alarming?: boolean
}) {
  const { label, hint } = QUADRANTS[quadrant]
  return (
    <span
      title={hint}
      className={`pointer-events-auto absolute text-[10px] leading-tight
        ${count === 0 ? "text-zinc-700" : alarming ? "text-amber-400/80" : "text-zinc-500"}
        ${className}`}
    >
      {label}
      {count > 0 && <span className="ml-1 font-semibold tabular-nums">{count}</span>}
    </span>
  )
}
