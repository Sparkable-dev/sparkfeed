import { createFileRoute, redirect } from "@tanstack/react-router"
import { loadWorkspaceWithArticles } from "@/lib/article-query"
import { loadWorkspaceData } from "@/lib/workspace-query"
import { RSSShell } from "@/components/RSSShell"

export const Route = createFileRoute("/_protected/favorites")({
  validateSearch: (search: Record<string, unknown>) => ({
    scope:
      search.scope === "workspace"
        ? ("workspace" as const)
        : ("personal" as const),
  }),
  loaderDeps: ({ search }) => ({ scope: search.scope }),
  loader: async ({ context, deps }) => {
    const data = await loadWorkspaceData(context)
    if (deps.scope === "workspace" && !data.favorites.workspaceEnabled)
      throw redirect({ to: "/favorites", search: { scope: "personal" } })
    return await loadWorkspaceWithArticles(context, {
      favorites: deps.scope,
      days: 0,
    })
  },
  component: FavoritesPage,
})

function FavoritesPage() {
  const data = Route.useLoaderData()
  const { scope } = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <RSSShell
      initialData={{
        folders: data.folders,
        feeds: data.feeds,
        articles: data.articles,
      }}
      title="Favorites"
      skipDateFilter
      favoritesView
      favoriteScope={scope}
      onFavoriteScopeChange={(nextScope) =>
        void navigate({ search: { scope: nextScope } })
      }
    />
  )
}
