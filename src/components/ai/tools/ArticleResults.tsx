import * as React from "react"
import { NewspaperIcon } from "lucide-react"
import { ToolCard, ToolResult, relativeTime } from "./shared"
import type { ToolStatus } from "./shared"
import type { SearchArticlesResult } from "@/server/tools/types"
import { ArticleThumb } from "@/components/ArticleThumb"
import { useArtifactPanel } from "@/components/ai/artifacts/artifact-context"

const MAX_ROWS = 12

const ROW = "flex w-full gap-2.5 px-3 py-2 text-start transition-colors hover:bg-muted/40"

/**
 * A row is a button when there is a panel to open it in, and a link when there
 * is not — the thread can be mounted without the panel, and a row that silently
 * did nothing there would be worse than one that leaves the app.
 */
function ArticleRowShell({
  url,
  onOpen,
  children,
}: {
  url: string
  onOpen: (() => void) | null
  children: React.ReactNode
}) {
  if (!onOpen) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className={ROW}>
        {children}
      </a>
    )
  }
  return (
    <button type="button" onClick={onOpen} className={ROW}>
      {children}
    </button>
  )
}

/**
 * Search and "what's new" results.
 *
 * Reuses `ArticleThumb` rather than rendering an `<img>`, which matters more
 * than it looks: search results carry no image URL, so every thumbnail here is
 * the fallback path — the source-keyed mark that makes a publication look the
 * same everywhere in the app. A bare `<img src={null}>` would render a broken
 * icon on every row.
 *
 * A row opens the article in the panel rather than a new tab. These are
 * articles the workspace already has, so the reader has the text cached and
 * there is no reason to hand the user off to the publisher's page and its
 * cookie banner. The publisher's own page is one click further, from the panel.
 */
export function ArticleResults({
  result,
  status,
}: {
  result?: SearchArticlesResult
  status?: ToolStatus
}) {
  const panel = useArtifactPanel()
  return (
    <ToolResult
      result={result}
      status={status}
      runningLabel="Searching your articles…"
    >
      {(data) => {
        const rows = data.articles.slice(0, MAX_ROWS)
        const hidden = data.articles.length - rows.length

        return (
          <ToolCard
            icon={NewspaperIcon}
            title="Articles"
            meta={`${data.articles.length}${data.next_cursor ? "+" : ""}`}
          >
            {data.articles.length === 0 ? (
              <p className="px-3 py-2.5 text-xs text-muted-foreground">
                Nothing matched.
              </p>
            ) : (
              <ul className="divide-y divide-border/40">
                {rows.map((article) => (
                  <li key={article.id}>
                    <ArticleRowShell
                      url={article.url}
                      onOpen={
                        panel
                          ? () =>
                              panel.open({
                                id: `article_${article.id}`,
                                kind: "article",
                                title: article.title,
                                source: {
                                  type: "workspace",
                                  articleId: article.id,
                                },
                              })
                          : null
                      }
                    >
                      {/*
                        The wrapper carries the size, not the thumb.
                        `ArticleThumb` is `size-full` by design — every other
                        caller puts it in a box with explicit dimensions — so
                        bare in a flex row it took the whole width and squeezed
                        the title to nothing.
                      */}
                      <div className="size-10 shrink-0 overflow-hidden rounded-md">
                        <ArticleThumb
                          src={null}
                          link={article.url}
                          name={article.source.name}
                          scale="sm"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-foreground">
                          {article.title}
                        </p>
                        {article.snippet ? (
                          <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                            {article.snippet}
                          </p>
                        ) : null}
                        <p className="mt-0.5 text-[10px] text-muted-foreground/80">
                          {article.source.name}
                          {" · "}
                          {relativeTime(article.published_at)}
                          {!article.is_read ? " · unread" : ""}
                        </p>
                      </div>
                    </ArticleRowShell>
                  </li>
                ))}
              </ul>
            )}
            {hidden > 0 || data.next_cursor ? (
              <p className="border-t border-border/50 px-3 py-1.5 text-[10px] text-muted-foreground">
                {hidden > 0 ? `${hidden} more in this page` : "More available"}
              </p>
            ) : null}
          </ToolCard>
        )
      }}
    </ToolResult>
  )
}
