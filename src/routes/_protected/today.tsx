import { createFileRoute } from "@tanstack/react-router"
import { RSSShell } from "@/components/RSSShell"
import { getAllData } from "@/server/rss"

export const Route = createFileRoute("/_protected/today")({
  loader: async () => {
    return await getAllData()
  },
  component: TodayPage,
})

function TodayPage() {
  const data = Route.useLoaderData()

  return (
    <RSSShell
      initialData={{ folders: data.folders, feeds: data.feeds, articles: data.articles as any }}
      title="Today"
      skipDateFilter
      filterArticles={(articles) => {
        // use a sliding 24-hour window for "Today"
        const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000)
        return articles.filter((a) => {
          const d = a.publishedAt
          return d && new Date(d) >= last24h
        })
      }}
    />
  )
}
