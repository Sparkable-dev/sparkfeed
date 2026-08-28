import { BarChart3Icon, CheckIcon, FilePlusIcon } from "lucide-react"
import { ToolCard, ToolResult } from "./shared"
import type { ToolStatus } from "./shared"
import type { ChartResult } from "@/server/tools/types"
import { SparkChart } from "@/components/ai/charts/SparkChart"
import { useArtifactPanel } from "@/components/ai/artifacts/artifact-context"

/**
 * The colour a chart's marks are drawn in, with a fallback for anywhere the
 * theme's variables are not in scope — a chart serialised out of the app should
 * still draw itself in the surrounding text colour rather than in nothing.
 *
 * `--chart-ink` rather than `--primary`: see the note beside it in styles.css.
 */
export const CHART_ACCENT = "var(--chart-ink, currentColor)"

/**
 * A chart of the workspace, and the button that files it.
 *
 * "Add to report" is what turns a conversation into a piece of work. Asking
 * five questions and getting five answers leaves nothing behind; filing the two
 * that mattered leaves a brief. The button appears on the chart because a chart
 * is the thing most worth keeping and least worth retyping.
 *
 * The same markup renders unchanged inside the report.
 */
export function ChartCard({
  result,
  toolCallId,
  status,
}: {
  result?: ChartResult
  toolCallId?: string
  status?: ToolStatus
}) {
  const panel = useArtifactPanel()

  return (
    <ToolResult result={result} status={status} runningLabel="Working it out…">
      {(data) => {
        const blockId = `chart_${toolCallId ?? data.metric}`
        const filed = panel?.isInReport(blockId) ?? false

        return (
          <ToolCard
            icon={BarChart3Icon}
            title={data.title}
            meta={
              data.delta
                ? `${data.total} ${data.unit} · ${data.delta}`
                : `${data.total} ${data.unit}`
            }
          >
            <div className="space-y-2 px-3 py-3">
              {/*
                The accent goes to the mark, not to the container. Wrapping the
                whole chart in `text-primary` tinted the labels and the counts
                as well, so the numbers — the part of a chart you read — were
                the lowest-contrast text on the card.
              */}
              <SparkChart
                shape={data.shape}
                points={data.points}
                accent={CHART_ACCENT}
              />

              <div className="flex items-center gap-2 pt-1">
                <p className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                  {data.summary}
                </p>

                {panel ? (
                  <button
                    type="button"
                    disabled={filed}
                    onClick={() =>
                      panel.addToReport({
                        id: blockId,
                        kind: "chart",
                        title: data.title,
                        summary: data.summary,
                        chart: {
                          shape: data.shape,
                          points: data.points,
                          unit: data.unit,
                          total: data.total,
                          delta: data.delta,
                        },
                      })
                    }
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-60"
                  >
                    {filed ? (
                      <>
                        <CheckIcon className="size-3" />
                        In report
                      </>
                    ) : (
                      <>
                        <FilePlusIcon className="size-3" />
                        Add to report
                      </>
                    )}
                  </button>
                ) : null}
              </div>
            </div>
          </ToolCard>
        )
      }}
    </ToolResult>
  )
}

/*
  `isInReport` is asked of the context rather than tracked locally, and rather
  than read off the open panel. The report is often closed while a card is on
  screen, and a card that lost track would offer to file a chart twice — or,
  worse, keep claiming "In report" after the user removed it, leaving no way to
  put it back.
*/
