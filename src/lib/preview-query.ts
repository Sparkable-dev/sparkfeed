import { queryOptions } from "@tanstack/react-query"
import { workspaceKey } from "./workspace-query"
import type { WorkspaceScope } from "./workspace-scope"
import { getArticlePreview } from "@/server/rss"

export function previewQuery(scope: WorkspaceScope, articleId: string) {
  return queryOptions({
    queryKey: [...workspaceKey(scope), "preview", articleId],
    queryFn: ({ signal }) =>
      getArticlePreview({ data: { ...scope, id: articleId }, signal }),
    staleTime: 10 * 60_000,
    gcTime: 15 * 60_000,
    retry: false,
  })
}
