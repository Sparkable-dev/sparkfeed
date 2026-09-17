import { CompassIcon, RssIcon } from "lucide-react"
import { ToolCard, ToolResult } from "./shared"
import { AddFeedButton } from "./AddFeedButton"
import type { ToolStatus } from "./shared"
import type { FindFeedsResult } from "@/server/tools/types"

/**
 * Candidate feeds from `find_feeds`, as cards you can act on.
 *
 * The sample headlines are the point. "Subscribe to this?" is unanswerable from
 * a feed URL and a name; three recent titles make it obvious within a second
 * whether a source is worth having. Anything already subscribed is marked
 * rather than hidden, so the user can see the search worked and simply found
 * things they already read.
 *
 * This used to carry a note saying an Add button here would be a second,
 * ungated write path around the autonomy pill. That reasoning was wrong — see
 * `AddFeedButton` for why — and the list was the poorer for it: the model would
 * name five feeds and the only way to act on any of them was to ask it again,
 * in prose, one at a time.
 */
export function FeedDiscovery({
  result,
  status,
}: {
  result?: FindFeedsResult
  status?: ToolStatus
}) {
  return (
    <ToolResult
      result={result}
      status={status}
      runningLabel="Looking for feeds…"
    >
      {(data) => (
        <ToolCard
          icon={CompassIcon}
          title={
            data.mode === "topic"
              ? "Suggested feeds"
              : "Feeds found on that site"
          }
          meta={`${data.feeds.length} found`}
        >
          {data.feeds.length === 0 ? (
            <p className="px-3 py-2.5 text-xs text-muted-foreground">
              Nothing found. Try a broader topic, or give a site URL.
            </p>
          ) : (
            <ul className="divide-y divide-border/40">
              {data.feeds.map((feed) => (
                <li key={feed.url} className="flex items-start gap-3 px-3 py-2.5">
                  <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border border-border/50 bg-muted/40 text-muted-foreground">
                    <RssIcon className="size-3.5" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-foreground">
                      {feed.title}
                    </p>
                    <p className="truncate text-[10px] text-muted-foreground">
                      {domainOf(feed.site_url ?? feed.url)}
                      {feed.source_kind === "page" ? " · Website" : " · RSS"}
                      {feed.verification === "cached" ? " · Catalogue suggestion, not checked live" : ""}
                      {feed.category ? ` · ${feed.category}` : ""}
                      {feed.item_count ? ` · ${feed.item_count} items` : ""}
                    </p>

                    {feed.description ? (
                      <p className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">
                        {feed.description}
                      </p>
                    ) : null}

                    {feed.sample_titles.length > 0 ? (
                      <ul className="mt-1 space-y-0.5">
                        {feed.sample_titles.map((title) => (
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

                  <AddFeedButton
                    size="sm"
                    url={feed.url}
                    name={feed.title}
                    sourceKind={feed.source_kind}
                    alreadyAdded={feed.already_subscribed}
                  />
                </li>
              ))}
            </ul>
          )}
        </ToolCard>
      )}
    </ToolResult>
  )
}

/** Hostname without `www.`, which is noise in a line this short. */
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}
