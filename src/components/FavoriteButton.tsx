import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Heart, Users } from "lucide-react"
import { toast } from "sonner"
import { useWorkspaceScope } from "./WorkspaceDataProvider"
import type { FavoriteScope } from "@/lib/workspace-scope"
import { workspaceKey, workspaceQuery } from "@/lib/workspace-query"
import { setFavorites } from "@/server/reader-data"
import { useReaderStore } from "@/store/readerStore"
import { DEMO_MODE } from "@/lib/demo"

export function FavoriteButton({
  articleId,
  scope = "personal",
}: {
  articleId: string
  scope?: FavoriteScope
}) {
  const activeWorkspace = useWorkspaceScope()
  const workspace = DEMO_MODE ? null : activeWorkspace
  const client = useQueryClient()
  const options = workspaceQuery(
    workspace ?? { userId: "guest", workspaceId: "guest" }
  )
  const { data } = useQuery({
    ...options,
    enabled: !!workspace,
    select: (nav) => ({
      saved: nav.favorites[scope].includes(articleId),
      enabled: scope === "personal" || nav.favorites.workspaceEnabled,
    }),
  })
  const guestSaved = useReaderStore((state) =>
    state.favorites.includes(articleId)
  )
  const toggleGuest = useReaderStore((state) => state.toggleFavorite)
  const saved = workspace ? (data?.saved ?? false) : guestSaved
  const mutation = useMutation({
    mutationKey: workspace
      ? [...workspaceKey(workspace), "favorite", scope, articleId]
      : ["guest-favorite"],
    scope: {
      id: `${workspace?.userId}:${workspace?.workspaceId}:${scope}:${articleId}`,
    },
    mutationFn: async (state: boolean) => {
      if (!workspace) return
      const result = await setFavorites({
        data: { ...workspace, ids: [articleId], scope, state },
      })
      if (!result.ids.includes(articleId))
        throw new Error("Article unavailable")
    },
    onMutate: async (state) => {
      await client.cancelQueries({ queryKey: options.queryKey })
      const previous =
        client
          .getQueryData(options.queryKey)
          ?.favorites[scope].includes(articleId) ?? false
      client.setQueryData(options.queryKey, (nav) =>
        nav
          ? {
              ...nav,
              favorites: {
                ...nav.favorites,
                [scope]: state
                  ? [...new Set([...nav.favorites[scope], articleId])]
                  : nav.favorites[scope].filter((id) => id !== articleId),
              },
            }
          : nav
      )
      return { previous }
    },
    onError: (_error, _state, rollback) => {
      client.setQueryData(options.queryKey, (nav) =>
        nav
          ? {
              ...nav,
              favorites: {
                ...nav.favorites,
                [scope]: rollback?.previous
                  ? [...new Set([...nav.favorites[scope], articleId])]
                  : nav.favorites[scope].filter((id) => id !== articleId),
              },
            }
          : nav
      )
      toast.error("Could not save this favorite. Please try again.")
    },
    onSuccess: async () => {
      if (workspace)
        await client.invalidateQueries({
          queryKey: [...workspaceKey(workspace), "articles"],
        })
    },
  })
  if (scope === "workspace" && (!workspace || !data?.enabled)) return null
  const Icon = scope === "workspace" ? Users : Heart
  const label = `${saved ? "Remove from" : "Add to"} ${scope} favorites`
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={saved}
      title={label}
      disabled={mutation.isPending}
      className="inline-flex size-8 items-center justify-center rounded-md text-zinc-400 hover:text-white disabled:opacity-50"
      onClick={(event) => {
        event.stopPropagation()
        if (!workspace) toggleGuest(articleId)
        else mutation.mutate(!saved)
      }}
    >
      <Icon
        className={`size-4 ${saved ? "text-red-400" : ""}`}
        fill={saved && scope === "personal" ? "currentColor" : "none"}
      />
    </button>
  )
}
