import { queryOptions } from "@tanstack/react-query"
import type { QueryClient } from "@tanstack/react-query"
import type { AnyRouter } from "@tanstack/react-router"
import type { WorkspaceScope } from "./workspace-scope"
import { getAllData } from "@/server/rss"

export function workspaceKey(scope: WorkspaceScope) {
  return ["workspace", scope.userId, scope.workspaceId] as const
}

export function workspaceQuery(scope: WorkspaceScope) {
  return queryOptions({
    queryKey: [...workspaceKey(scope), "navigation"],
    queryFn: ({ signal }) => getAllData({ data: scope, signal }),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: false,
  })
}

export function loadWorkspaceData(context: {
  queryClient: QueryClient
  workspaceScope: WorkspaceScope
}) {
  return context.queryClient.fetchQuery(workspaceQuery(context.workspaceScope))
}

/** Mutations invalidate both the query cache and routes that consume it. */
export async function invalidateWorkspace(router: AnyRouter) {
  const queryClient = router.options?.context?.queryClient as
    QueryClient | undefined
  await queryClient?.invalidateQueries({
    queryKey: ["workspace"],
    predicate: (query) => query.queryKey[3] !== "preview",
    refetchType: "none",
  })
  await router.invalidate({ sync: true })
  await queryClient?.refetchQueries({
    queryKey: ["workspace"],
    type: "active",
    stale: true,
  })
}
