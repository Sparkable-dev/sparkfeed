/**
 * Two charts, drawn as inline SVG, with no charting library.
 *
 * Not a size argument — a correctness one. A report exports to a
 * self-contained HTML document that renders in a sandboxed frame **with no
 * network**, so a chart built on a CDN library would export as a blank box. It
 * has to be markup that carries its own meaning, and once that is true for the
 * export it may as well be true everywhere.
 *
 * Colour is in two parts, which is the correction to the first version. The
 * *mark* takes `accent`; everything you read — labels, counts, the axis — stays
 * in the surrounding text colour. Painting the whole chart one colour was
 * simpler and produced folder names in low-contrast purple, the least legible
 * text on the card and the part that carries the meaning. `accent` still
 * defaults to `currentColor`, so a caller that sets a text colour and nothing
 * else gets the old behaviour and no hard-coded hex.
 */

export interface ChartPoint {
  label: string
  value: number
}

const VIEW_W = 600
const VIEW_H = 160

/**
 * A filled area over time, with a scale you can read a value off.
 *
 * It shipped without one: a purple shape, no gridlines, no axis, no dates. You
 * could see that Thursday was busier than Tuesday and nothing else — not how
 * much busier, not how many, not which Thursday. A chart that cannot be read
 * back to a number is decoration, and that is what it was called.
 *
 * So: two gridlines carrying the peak and the midpoint, the first and last
 * labels along the bottom, and the peak itself marked and named. Four numbers,
 * which is the fewest that makes the shape mean something.
 *
 * `preserveAspectRatio="none"` with a `viewBox`: the plot stretches to its
 * container's width and keeps a fixed drawing height, which is what makes it
 * behave in a panel that can be 380px or 900px wide. Strokes are drawn with
 * `vectorEffect` and text sits outside the stretched box — both would otherwise
 * come out squashed on one axis.
 */
export function AreaChart({
  points,
  className,
  accent = "currentColor",
}: {
  points: Array<ChartPoint>
  className?: string
  accent?: string
}) {
  if (points.length === 0) return <Empty className={className} />

  const max = Math.max(1, ...points.map((p) => p.value))
  const step = points.length > 1 ? VIEW_W / (points.length - 1) : VIEW_W

  const coords = points.map((point, index) => ({
    x: index * step,
    y: VIEW_H - (point.value / max) * (VIEW_H - 8) - 4,
  }))

  const line = `M${coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" L")}`
  const area = `${line} L${VIEW_W},${VIEW_H} L0,${VIEW_H} Z`

  const peakIndex = points.reduce(
    (best, point, index) => (point.value > points[best].value ? index : best),
    0
  )
  const peak = points[peakIndex]
  const first = points[0]
  const last = points[points.length - 1]

  return (
    <div className={className} style={{ display: "grid", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "stretch", gap: 8 }}>
        {/*
          The axis is real text in flow rather than <text> inside the stretched
          viewBox, which would be scaled horizontally along with the plot and
          come out wider on a wide panel than on a narrow one.
        */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            fontSize: 10,
            fontVariantNumeric: "tabular-nums",
            opacity: 0.7,
            textAlign: "right",
            minWidth: "1.75rem",
            paddingBottom: 2,
          }}
        >
          <span>{max.toLocaleString()}</span>
          <span>{Math.round(max / 2).toLocaleString()}</span>
          <span>0</span>
        </div>

        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${points.length} points, peak ${max} on ${peak.label}`}
          style={{ width: "100%", height: 120, display: "block" }}
        >
          {[0, 0.5, 1].map((fraction) => {
            const y = 4 + fraction * (VIEW_H - 8)
            return (
              <line
                key={fraction}
                x1={0}
                x2={VIEW_W}
                y1={y}
                y2={y}
                stroke="currentColor"
                strokeWidth={1}
                opacity={0.15}
                vectorEffect="non-scaling-stroke"
              />
            )
          })}

          {/*
            The fill is a wash under the line, not a second mark competing with
            it, so it stays well below half. What it must not be is invisible —
            at 0.14 on a dark surface the whole shape read as a smudge and the
            line was doing all the work on its own.
          */}
          <path d={area} fill={accent} opacity={0.3} />
          <path
            d={line}
            fill="none"
            stroke={accent}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          {/*
            `r` scales with the viewBox too, so a circle would be an ellipse.
            Two crossed strokes read as a marker at any width and cannot deform.
          */}
          <path
            d={`M${coords[peakIndex].x.toFixed(1)},${(coords[peakIndex].y - 6).toFixed(1)} v12`}
            stroke={accent}
            strokeWidth={2.5}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 8,
          fontSize: 10,
          opacity: 0.7,
          paddingLeft: "2.25rem",
        }}
      >
        <span>{first.label}</span>
        <span style={{ opacity: 0.9 }}>
          peak {peak.value.toLocaleString()} · {peak.label}
        </span>
        <span>{last.label}</span>
      </div>
    </div>
  )
}

/**
 * A ranking, as horizontal bars.
 *
 * Horizontal rather than vertical because the labels are folder and feed names.
 * Vertical bars would need them rotated or truncated to three characters, and a
 * chart whose labels are unreadable is a decoration.
 */
export function BarChart({
  points,
  className,
  accent = "currentColor",
}: {
  points: Array<ChartPoint>
  className?: string
  accent?: string
}) {
  if (points.length === 0) return <Empty className={className} />

  const max = Math.max(1, ...points.map((p) => p.value))
  const total = points.reduce((sum, point) => sum + point.value, 0)

  return (
    <ul className={className} style={{ display: "grid", gap: 6, margin: 0, padding: 0, listStyle: "none" }}>
      {points.map((point) => (
        <li
          key={point.label}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0,7rem) 1fr auto",
            alignItems: "center",
            gap: 10,
            fontSize: 11,
          }}
        >
          {/*
            Full opacity on the label. It used to inherit the accent along with
            the bar — the whole chart was wrapped in one colour — which left
            folder names as low-contrast purple on black, the least legible text
            on the card and the part you actually have to read.
          */}
          <span
            title={point.label}
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {point.label}
          </span>
          {/*
            The track is dimmed with a translucent colour, not with `opacity`.

            `opacity` applies to the whole subtree, so the 0.14 meant to fade the
            groove behind the bar was multiplying into the bar drawn inside it —
            every ranking was rendered at 14% strength no matter what colour it
            was handed. That is why the bars stayed dull after the accent was
            brightened: the accent was never the problem.
          */}
          <span
            style={{
              height: 9,
              borderRadius: 5,
              background: "color-mix(in oklab, currentColor 14%, transparent)",
              position: "relative",
            }}
          >
            <span
              style={{
                position: "absolute",
                insetBlock: 0,
                insetInlineStart: 0,
                width: `${Math.max(2, (point.value / max) * 100)}%`,
                borderRadius: 5,
                background: accent,
              }}
            />
          </span>
          {/*
            The count and its share. A bar already shows the ranking; what it
            cannot show is whether the leader is a third of the total or nearly
            all of it, which is usually the thing worth knowing.
          */}
          <span
            style={{
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
            }}
          >
            {point.value.toLocaleString()}
            {total > 0 ? (
              <span style={{ opacity: 0.5 }}>
                {" "}
                {Math.round((point.value / total) * 100)}%
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  )
}

function Empty({ className }: { className?: string }) {
  return (
    <p className={className} style={{ fontSize: 11, opacity: 0.6, margin: 0 }}>
      Nothing to plot yet.
    </p>
  )
}

/**
 * Both marks, chosen by shape.
 *
 * Inline styles rather than Tailwind classes, deliberately: this same markup is
 * serialised into an exported report, which is a standalone document with no
 * stylesheet of ours in it. Classes would export as unstyled boxes.
 */
export function SparkChart({
  shape,
  points,
  className,
  accent,
}: {
  shape: "series" | "bars"
  points: Array<ChartPoint>
  className?: string
  /**
   * Colour for the mark alone — the line, the fill, the bar.
   *
   * Split out from `currentColor` so labels and numbers can stay in the
   * surrounding text colour. Wrapping the whole chart in the accent was what
   * made the axis unreadable. Defaults back to `currentColor`, so a caller that
   * does set a text colour on the container still gets a chart that matches.
   */
  accent?: string
}) {
  return shape === "series" ? (
    <AreaChart points={points} className={className} accent={accent} />
  ) : (
    <BarChart points={points} className={className} accent={accent} />
  )
}
