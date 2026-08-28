import { AlertTriangleIcon, RssIcon } from "lucide-react"
import { ToolCard, ToolResult, relativeTime } from "./shared"
import type { ToolStatus } from "./shared"
import type { ListFeedsResult } from "@/server/tools/types"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"

const MAX_ROWS = 25

/**
 * The subscription list.
 *
 * A table rather than cards because the useful reading here is comparative —
 * which source is quiet, which is failing — and that only works when the
 * numbers line up in columns.
 *
 * Scraped sites appear alongside RSS feeds with null article stats, because
 * `scraped_articles` carries no read state. Rendering "0 unread" for them would
 * claim they are all read.
 */
export function FeedTable({
  result,
  status,
}: {
  result?: ListFeedsResult
  status?: ToolStatus
}) {
  return (
    <ToolResult
      result={result}
      status={status}
      runningLabel="Reading your feeds…"
    >
      {(data) => {
        const rows = data.feeds.slice(0, MAX_ROWS)
        const hidden = data.feeds.length - rows.length

        return (
          <ToolCard
            icon={RssIcon}
            title="Feeds"
            meta={`${data.feeds.length} ${data.feeds.length === 1 ? "source" : "sources"}`}
          >
            {data.feeds.length === 0 ? (
              <p className="px-3 py-2.5 text-xs text-muted-foreground">
                No feeds yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table className="text-xs">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="h-8">Source</TableHead>
                      <TableHead className="h-8 text-right">Unread</TableHead>
                      <TableHead className="h-8 text-right">30d</TableHead>
                      <TableHead className="h-8 text-right">
                        Last post
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((feed) => (
                      <TableRow key={feed.id}>
                        <TableCell className="max-w-[16rem]">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate font-medium text-foreground">
                              {feed.name}
                            </span>
                            {feed.kind === "scraped" ? (
                              <Badge
                                variant="secondary"
                                className="shrink-0 text-[10px]"
                              >
                                scraped
                              </Badge>
                            ) : null}
                            {feed.last_error ? (
                              <AlertTriangleIcon className="size-3 shrink-0 text-amber-500" />
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {feed.unread_count ?? "—"}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground tabular-nums">
                          {feed.posts_30d ?? "—"}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {relativeTime(
                            feed.last_published_at ?? feed.last_fetched_at
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {hidden > 0 ? (
              <p className="border-t border-border/50 px-3 py-1.5 text-[10px] text-muted-foreground">
                {hidden} more not shown
              </p>
            ) : null}
          </ToolCard>
        )
      }}
    </ToolResult>
  )
}
