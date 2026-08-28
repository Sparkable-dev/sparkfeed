import { BookOpenIcon, FileTextIcon } from "lucide-react"
import { ToolCard, ToolResult } from "./shared"
import type { ToolStatus } from "./shared"
import type { GetArticleResult } from "@/server/tools/types"
import { SparkLink } from "@/components/ai/SparkLink"
import { Badge } from "@/components/ui/badge"
import { useArtifactPanel } from "@/components/ai/artifacts/artifact-context"

/**
 * One fetched article.
 *
 * Shows the header and provenance, not the body. The model is about to
 * summarise or quote the text in its own reply, so printing the full article
 * here as well would duplicate the whole thing on screen. What is worth
 * surfacing is where the text came from — extracted from the page, or only the
 * RSS description — because that is what tells the user how much to trust a
 * thin summary.
 */
export function ArticleCard({
  result,
  status,
}: {
  result?: GetArticleResult
  status?: ToolStatus
}) {
  const panel = useArtifactPanel()
  return (
    <ToolResult
      result={result}
      status={status}
      runningLabel="Fetching the article…"
    >
      {(article) => (
        <ToolCard
          icon={FileTextIcon}
          title="Article"
          meta={`${article.word_count} words`}
        >
          <div className="space-y-1.5 px-3 py-2.5">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <SparkLink url={article.url}>{article.title}</SparkLink>
              </div>
              {/*
                The body is still not printed here — the model is about to
                summarise it — but "read the whole thing" is now one click
                rather than a trip to the publisher's page.
              */}
              {panel && article.source_quality === "extracted" ? (
                <button
                  type="button"
                  onClick={() =>
                    panel.open({
                      id: `article_${article.id}`,
                      kind: "article",
                      title: article.title,
                      source: { type: "workspace", articleId: article.id },
                    })
                  }
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <BookOpenIcon className="size-3" />
                  Read
                </button>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
              <span>{article.source}</span>
              {article.published_at ? (
                <span>
                  · {new Date(article.published_at).toLocaleDateString()}
                </span>
              ) : null}
              {article.source_quality !== "extracted" ? (
                <Badge variant="secondary" className="text-[10px]">
                  {article.source_quality === "rss_description"
                    ? "summary only"
                    : "no text available"}
                </Badge>
              ) : null}
              {article.truncated ? (
                <Badge variant="secondary" className="text-[10px]">
                  truncated
                </Badge>
              ) : null}
            </div>
          </div>
        </ToolCard>
      )}
    </ToolResult>
  )
}
