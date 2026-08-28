import { GlobeIcon, SearchIcon } from "lucide-react"
import { ToolCard, ToolResult } from "./shared"
import type { ToolStatus } from "./shared"
import type { WebSearchResult } from "@/server/ai/web-search"
import { useArtifactPanel } from "@/components/ai/artifacts/artifact-context"

/**
 * Results from the live web.
 *
 * Deliberately flatter and cooler than the feed cards. Those are a product
 * decision — a thing you can own, with an Add button and a source mark — while
 * these are references: someone else's page, quoted once. Giving them the same
 * warmth would make "a feed you could subscribe to" and "a page that mentioned
 * your query" look like the same kind of object, and the difference matters
 * most exactly when a search returns a blog that also has a feed.
 *
 * Each row opens in the reader panel through `read_url`, so following a
 * citation does not mean leaving the conversation.
 *
 * The search model's own answer is deliberately **not** rendered. It is already
 * in the model's context and about to appear in its reply; printing it here as
 * well would show the user the same paragraph twice, once in a voice that is
 * not Spark's. The citations are the part only this card can show.
 */
export function WebSearchResults({
  result,
  status,
}: {
  result?: WebSearchResult
  status?: ToolStatus
}) {
  const panel = useArtifactPanel()

  return (
    <ToolResult result={result} status={status} runningLabel="Searching the web…">
      {(data) => (
        <ToolCard
          icon={SearchIcon}
          title="Web search"
          meta={`${data.sources.length} ${data.sources.length === 1 ? "source" : "sources"}`}
        >
          <div className="space-y-2 px-3 py-2.5">
            <p className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground">
              <SearchIcon className="size-2.5 shrink-0" />
              <span className="truncate">{data.query}</span>
            </p>

            {data.sources.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                No sources came back with that answer, so treat it with more
                caution than usual.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {data.sources.map((source, index) => (
                  <li key={source.url}>
                    <button
                      type="button"
                      disabled={!panel}
                      onClick={() =>
                        panel?.open({
                          id: `search_${source.url}`,
                          kind: "article",
                          title: source.title,
                          source: { type: "url", url: source.url },
                        })
                      }
                      className="flex w-full items-baseline gap-2 rounded px-1 py-1 text-start transition-colors hover:bg-accent/40 disabled:pointer-events-none"
                    >
                      {/* Numbered, because an answer that says "[2]" needs a 2. */}
                      <span className="w-4 shrink-0 text-[10px] tabular-nums text-muted-foreground/60">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] text-foreground">
                          {source.title}
                        </span>
                        <span className="block truncate text-[10px] text-muted-foreground/70">
                          {source.domain}
                        </span>
                      </span>
                      <GlobeIcon className="size-3 shrink-0 text-muted-foreground/50" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </ToolCard>
      )}
    </ToolResult>
  )
}
