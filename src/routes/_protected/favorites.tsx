import { createFileRoute } from "@tanstack/react-router"
import { RSSShell } from "@/components/RSSShell"
import { getAllData } from "@/server/rss"
import { useReaderStore } from "@/store/readerStore"

export const Route = createFileRoute("/_protected/favorites")({
  loader: async () => {
    return await getAllData()
  },
  component: FavoritesPage,
})

function FavoritesPage() {
  const data = Route.useLoaderData()
  // Use Zustand store (persisted in localStorage) as the source of truth.
  // The DB isFavorite column can get out of sync on refresh; Zustand never loses state.
  const favIds = useReaderStore((s) => s.favorites)
  const favSet = new Set(favIds)

  return (
    <RSSShell
      initialData={{ folders: data.folders, feeds: data.feeds, articles: data.articles as any }}
      title="Favorites"
      skipDateFilter
      filterArticles={(articles) => articles.filter((a) => favSet.has(a.id) || a.isFavorite)}
    />
  )
}
