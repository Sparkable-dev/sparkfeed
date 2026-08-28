import { CheckCircle2Icon, RssIcon } from "lucide-react"
import { ToolCard, ToolResult } from "./shared"
import { domainOf } from "./FeedDiscovery"
import type { ToolStatus } from "./shared"
import type { AddFeedResult } from "@/server/tools/types"

/**
 * The agent's own `add_feed`, confirmed.
 *
 * The write tools deliberately had no renderers — their results are a sentence,
 * which the model says better in prose than a component would. `add_feed` is
 * the exception now that the same action has a button beside it: without this,
 * asking Spark to subscribe produced a line of text while clicking Add produced
 * a card, and the two looked like different features.
 */
export function FeedAdded({
  result,
  status,
}: {
  result?: AddFeedResult
  status?: ToolStatus
}) {
  return (
    <ToolResult result={result} status={status} runningLabel="Adding the feed…">
      {(data) => (
        <ToolCard
          icon={CheckCircle2Icon}
          title="Feed added"
          meta={
            data.articles_imported > 0
              ? `${data.articles_imported} articles`
              : undefined
          }
        >
          <div className="flex items-center gap-3 px-3 py-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-border/50 bg-muted/40 text-muted-foreground">
              <RssIcon className="size-3.5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-foreground">
                {data.feed.name}
              </p>
              <p className="truncate text-[10px] text-muted-foreground">
                {domainOf(data.feed.url)}
              </p>
            </div>
          </div>
        </ToolCard>
      )}
    </ToolResult>
  )
}
