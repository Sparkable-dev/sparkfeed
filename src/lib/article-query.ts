import { infiniteQueryOptions } from "@tanstack/react-query"
import { loadWorkspaceData, workspaceKey } from "./workspace-query"
import type { QueryClient } from "@tanstack/react-query"
import type { FavoriteScope, WorkspaceScope } from "./workspace-scope"
import { getArticlePage } from "@/server/reader-data"

export interface ArticleFilters {
  feedId?: string
  folderId?: string
  favorites?: FavoriteScope
  days?: number
  query?: string
  demoFavoriteIds?: Array<string>
}
export function articlePagesQuery(
  scope: WorkspaceScope,
  filters: ArticleFilters = {}
) {
  const input = { days: 15, query: "", ...filters }
  return infiniteQueryOptions({
    queryKey: [...workspaceKey(scope), "articles", input],
    queryFn: ({ pageParam, signal }) =>
      getArticlePage({
        data: { ...scope, ...input, cursor: pageParam },
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: false,
  })
}

export async function loadWorkspaceWithArticles(
  context: { queryClient: QueryClient; workspaceScope: WorkspaceScope },
  filters: ArticleFilters = {}
) {
  const [data] = await Promise.all([
    loadWorkspaceData(context),
    context.queryClient.fetchInfiniteQuery(
      articlePagesQuery(context.workspaceScope, filters)
    ),
  ])
  return data
}
