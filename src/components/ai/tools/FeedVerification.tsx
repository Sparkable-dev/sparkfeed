import { AlertTriangleIcon, CheckCircle2Icon, RssIcon } from "lucide-react"
import { ToolCard, ToolResult, relativeTime } from "./shared"
import { AddFeedButton } from "./AddFeedButton"
import { domainOf } from "./FeedDiscovery"
import type { ToolStatus } from "./shared"
import type { VerifyFeedResult } from "@/server/tools/types"

/**
 * One URL, checked.
 *
 * A label/value sheet rather than a paragraph, because every row here is a
 * decision input: is it a feed, how often does it post, is it still alive, and
 * do I already have it. Prose makes those four facts take four sentences and
 * still leaves the reader comparing them by hand.
 *
 * An invalid feed gets the same card, not an error state. "That is not a feed"
 * is an answer to the question asked, and the address the user pasted is worth
 * showing back to them so they can see what was actually checked.
 */
export function FeedVerification({
  result,
  status,
}: {
  result?: VerifyFeedResult
  status?: ToolStatus
}) {
  return (
    <ToolResult result={result} status={status} runningLabel="Checking that URL…">
      {(data) =>
        data.valid ? (
          <ToolCard
            icon={CheckCircle2Icon}
            title={data.source_kind === "page" ? "Website checked" : "Feed confirmed"}
            meta={data.already_subscribed ? "already subscribed" : undefined}
          >
            <div className="space-y-2.5 px-3 py-2.5">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border border-border/50 bg-muted/40 text-muted-foreground">
                  <RssIcon className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {data.title ?? domainOf(data.url ?? data.requested_url)}
                  </p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {data.url}
                  </p>
                </div>
                <AddFeedButton
                  url={data.url!}
                  name={data.title ?? domainOf(data.url!)}
                  sourceKind={data.source_kind}
                  alreadyAdded={data.already_subscribed}
                />
              </div>

              {data.quality === "partial" && <p className="text-xs text-amber-500">Some articles could only be saved as links. Reader content may be unavailable.</p>}
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[11px]">
                <Row label="Items" value={`${data.item_count ?? 0}`} />
                <Row
                  label="Posts"
                  value={
                    data.posts_per_week === null
                      ? "not enough dates to tell"
                      : `about ${data.posts_per_week} a week`
                  }
                />
                <Row
                  label="Last post"
                  value={relativeTime(data.last_published_at)}
                />
              </dl>

              {data.sample_titles.length > 0 ? (
                <ul className="space-y-0.5 border-t border-border/40 pt-2">
                  {data.sample_titles.map((title) => (
                    <li
                      key={title}
                      className="truncate text-[10px] text-muted-foreground/80 before:mr-1 before:content-['·']"
                    >
                      {title}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </ToolCard>
        ) : (
          <ToolCard icon={AlertTriangleIcon} title="Not a feed">
            <div className="space-y-1 px-3 py-2.5">
              <p className="truncate text-xs text-foreground">
                {data.requested_url}
              </p>
              <p className="text-[11px] text-muted-foreground">{data.reason}</p>
            </div>
          </ToolCard>
        )
      }
    </ToolResult>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{value}</dd>
    </>
  )
}
