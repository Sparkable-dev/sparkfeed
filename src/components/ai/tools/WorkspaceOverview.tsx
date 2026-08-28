import { AlertTriangleIcon, GaugeIcon } from "lucide-react"
import { ToolCard, ToolResult } from "./shared"
import type { ToolStatus } from "./shared"
import type { WorkspaceInfoResult } from "@/server/tools/types"
import { Badge } from "@/components/ui/badge"

/**
 * The answer to "how many feeds do we have".
 *
 * Leads with the four numbers people actually ask for, then the two lists that
 * turn a count into a picture: where the unread is piling up, and what is
 * broken. Anything the model would otherwise have to make four more tool calls
 * to learn is here.
 */
export function WorkspaceOverview({
  result,
  status,
}: {
  result?: WorkspaceInfoResult
  status?: ToolStatus
}) {
  return (
    <ToolResult
      result={result}
      status={status}
      runningLabel="Reading your workspace…"
    >
      {(data) => (
        <ToolCard
          icon={GaugeIcon}
          title="Workspace overview"
          meta={data.workspace.demo ? "demo" : undefined}
        >
          <div className="grid grid-cols-2 gap-px bg-border/40 sm:grid-cols-4">
            <Stat
              label="Feeds"
              value={data.counts.feeds}
              hint={feedSplit(data)}
            />
            <Stat label="Folders" value={data.counts.folders} />
            <Stat
              label="Articles"
              value={data.counts.articles_total}
              hint={`${data.counts.articles_30d} in 30d`}
            />
            <Stat label="Unread" value={data.counts.unread} />
          </div>

          {data.busiest_folders.length > 0 ? (
            <Section title="Most unread">
              {data.busiest_folders.map((f) => (
                <Row key={f.id} name={f.name} value={`${f.unread} unread`} />
              ))}
            </Section>
          ) : null}

          {data.busiest_feeds.length > 0 ? (
            <Section title="Busiest feeds">
              {data.busiest_feeds.map((f) => (
                <Row
                  key={f.id}
                  name={f.name}
                  value={`${f.posts_30d} posts / 30d`}
                />
              ))}
            </Section>
          ) : null}

          {data.needs_attention.length > 0 ? (
            <Section title="Needs attention">
              {data.needs_attention.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs"
                >
                  <AlertTriangleIcon className="size-3 shrink-0 text-amber-500" />
                  <span className="truncate text-foreground">{f.name}</span>
                  <Badge
                    variant="secondary"
                    className="ml-auto shrink-0 text-[10px]"
                  >
                    {f.never_fetched ? "never fetched" : "fetch error"}
                  </Badge>
                </div>
              ))}
            </Section>
          ) : null}
        </ToolCard>
      )}
    </ToolResult>
  )
}

function feedSplit(data: WorkspaceInfoResult): string | undefined {
  // Only worth showing when there actually are scraped sources; otherwise it is
  // noise that invites the question "what is a scraped feed".
  if (!data.counts.feeds_scraped) return undefined
  return `${data.counts.feeds_rss} rss · ${data.counts.feeds_scraped} scraped`
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string
  value: number
  hint?: string
}) {
  return (
    <div className="bg-card px-3 py-2.5">
      <div className="text-lg font-semibold text-foreground tabular-nums">
        {value.toLocaleString()}
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
      {hint ? (
        <div className="mt-0.5 text-[10px] text-muted-foreground/70">
          {hint}
        </div>
      ) : null}
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="border-t border-border/50">
      <div className="px-3 pt-2 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </div>
      <div className="pb-1.5">{children}</div>
    </div>
  )
}

function Row({ name, value }: { name: string; value: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1 text-xs">
      <span className="truncate text-foreground">{name}</span>
      <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">
        {value}
      </span>
    </div>
  )
}
