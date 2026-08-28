import { AlertTriangleIcon, BookOpenIcon, NewspaperIcon } from "lucide-react"
import { ToolCard, ToolResult } from "./shared"
import type { ToolStatus } from "./shared"
import type { ReadUrlResult } from "@/server/tools/types"
import { useArtifactPanel } from "@/components/ai/artifacts/artifact-context"
import { cn } from "@/lib/utils"

/**
 * A page the model went and read.
 *
 * Clicking it opens the full article in the panel rather than expanding it in
 * the transcript. An article is usually longer than the whole conversation
 * around it, and inlining one would bury the thread it belongs to — the panel
 * is the place with room to read.
 *
 * The card shows the publisher's own image when the page advertised one. It is
 * the single strongest signal of *which* story this is, and it costs nothing:
 * `extractReadable` already had the document open.
 */
export function ReadUrlCard({
  result,
  toolCallId,
  status,
}: {
  result?: ReadUrlResult
  toolCallId?: string
  status?: ToolStatus
}) {
  const panel = useArtifactPanel()

  return (
    <ToolResult result={result} status={status} runningLabel="Reading the page…">
      {(data) => {
        const title = data.title ?? data.domain
        const failed = data.source_quality === "failed"

        const open = () =>
          panel?.open({
            id: `read_${toolCallId ?? data.url}`,
            kind: "article",
            title,
            source: { type: "url", url: data.url },
          })

        return (
          <ToolCard
            icon={failed ? AlertTriangleIcon : NewspaperIcon}
            title={failed ? "Could not read that page" : "Article"}
            meta={
              failed
                ? undefined
                : `${data.word_count.toLocaleString()} words · ${readingTime(data.word_count)}`
            }
          >
            <button
              type="button"
              onClick={open}
              disabled={!panel || failed}
              className={cn(
                "flex w-full items-start gap-3 px-3 py-2.5 text-start transition-colors",
                panel && !failed && "hover:bg-accent/40"
              )}
            >
              {data.image ? (
                <img
                  src={data.image}
                  alt=""
                  loading="lazy"
                  className="h-14 w-20 shrink-0 rounded-md border border-border/50 object-cover"
                  // A hotlinked image that 404s leaves a broken-image glyph,
                  // which looks like our bug rather than the publisher's.
                  onError={(event) => {
                    event.currentTarget.style.display = "none"
                  }}
                />
              ) : null}

              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-foreground">
                  {title}
                </span>
                <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                  {data.domain}
                  {data.byline ? ` · ${data.byline}` : ""}
                </span>
                {failed ? (
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    Nothing readable in the HTML — likely a paywall, a login, or
                    a page that builds itself in the browser.
                  </span>
                ) : data.excerpt ? (
                  <span className="mt-1 line-clamp-2 block text-[11px] text-muted-foreground">
                    {data.excerpt}
                  </span>
                ) : null}
              </span>

              {panel && !failed ? (
                <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[10px] font-medium text-muted-foreground">
                  <BookOpenIcon className="size-3" />
                  Read
                </span>
              ) : null}
            </button>
          </ToolCard>
        )
      }}
    </ToolResult>
  )
}

/** 240 wpm, the usual figure for online reading. */
export function readingTime(words: number): string {
  const minutes = Math.max(1, Math.round(words / 240))
  return `${minutes} min read`
}
