import * as React from "react"
import { CheckIcon, CopyIcon, DownloadIcon, Trash2Icon, XIcon } from "lucide-react"
import type { ReportArtifact, ReportBlock } from "./artifact-context"
import { SparkChart } from "@/components/ai/charts/SparkChart"
import { CHART_ACCENT } from "@/components/ai/tools/ChartCard"
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button"

/**
 * The report being assembled.
 *
 * Charts, notes and findings filed one at a time from the conversation, in the
 * order they were added, exported as markdown when it is done. The point is the
 * shape of the work someone doing research actually does: ask, look, keep the
 * two things that mattered, move on — and end up with something to paste into a
 * brief rather than a chat log to re-read.
 */
export function ReportPanel({
  artifact,
  onRemove,
  onClose,
}: {
  artifact: ReportArtifact
  onRemove: (blockId: string) => void
  onClose: () => void
}) {
  const [copied, setCopied] = React.useState(false)

  React.useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  const markdown = React.useMemo(
    () => toMarkdown(artifact.blocks),
    [artifact.blocks]
  )

  return (
    <aside
      className="fixed inset-0 z-40 flex min-w-0 flex-1 flex-col bg-background md:static md:z-0 md:border-s md:border-border/60"
      aria-label="Report"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">Report</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {artifact.blocks.length === 0
              ? "Nothing filed yet"
              : `${artifact.blocks.length} ${artifact.blocks.length === 1 ? "block" : "blocks"}`}
          </p>
        </div>

        <TooltipIconButton
          tooltip={copied ? "Copied" : "Copy as markdown"}
          disabled={artifact.blocks.length === 0}
          onClick={() => {
            void navigator.clipboard.writeText(markdown).then(() => setCopied(true))
          }}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </TooltipIconButton>
        <TooltipIconButton
          tooltip="Download markdown"
          disabled={artifact.blocks.length === 0}
          onClick={() => download(markdown)}
        >
          <DownloadIcon />
        </TooltipIconButton>
        <TooltipIconButton tooltip="Close" onClick={onClose}>
          <XIcon />
        </TooltipIconButton>
      </header>

      <div className="min-h-0 flex-1 overflow-auto bg-muted/20 p-4">
        {artifact.blocks.length === 0 ? (
          <div className="grid h-full place-items-center px-8 text-center">
            <p className="max-w-xs text-sm text-muted-foreground">
              Nothing here yet. Every chart and article card in the conversation
              has an <span className="text-foreground">Add to report</span>{" "}
              button — this is where they land.
            </p>
          </div>
        ) : (
          <div className="mx-auto max-w-[46rem] space-y-3">
            {artifact.blocks.map((block) => (
              <article
                key={block.id}
                className="group/block relative rounded-xl border border-border/60 bg-card/60 p-4"
              >
                <header className="mb-2 flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-medium text-foreground">
                      {block.title}
                    </h3>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {block.summary}
                    </p>
                  </div>
                  {block.chart ? (
                    <div className="shrink-0 text-end">
                      <p className="text-lg leading-none font-semibold tabular-nums text-foreground">
                        {block.chart.total}
                      </p>
                      {block.chart.delta ? (
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          {block.chart.delta}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    aria-label="Remove from report"
                    onClick={() => onRemove(block.id)}
                    className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground opacity-0 transition-opacity group-hover/block:opacity-100 hover:bg-accent hover:text-foreground"
                  >
                    <Trash2Icon className="size-3.5" />
                  </button>
                </header>

                {block.chart ? (
                  <SparkChart
                    shape={block.chart.shape}
                    points={block.chart.points}
                    accent={CHART_ACCENT}
                  />
                ) : null}
              </article>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}

/**
 * Markdown, not HTML.
 *
 * A chart becomes its summary plus a small table of the numbers behind it. That
 * is deliberately not a picture: markdown is what gets pasted into a doc, a
 * ticket or a newsletter, and a table survives that trip while an inline SVG
 * does not. The numbers are also the part a reader can check.
 */
export function toMarkdown(blocks: Array<ReportBlock>): string {
  const parts: Array<string> = ["# Report", ""]

  for (const block of blocks) {
    parts.push(`## ${block.title}`, "", block.summary, "")

    if (block.chart) {
      const { unit, points, total, delta } = block.chart
      parts.push(
        `**${total}** ${unit}${delta ? ` · ${delta}` : ""}`,
        "",
        "| | |",
        "| --- | ---: |",
        ...points.map((p) => `| ${p.label} | ${p.value.toLocaleString()} |`),
        ""
      )
    }
  }

  return parts.join("\n").trimEnd() + "\n"
}

function download(markdown: string) {
  const blob = new Blob([markdown], { type: "text/markdown" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = "report.md"
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
