import { createFileRoute } from "@tanstack/react-router"
import { loadWorkspaceWithArticles } from "@/lib/article-query"
import { RSSShell } from "@/components/RSSShell"

export const Route = createFileRoute("/_protected/today")({
  loader: async ({ context }) => {
    return await loadWorkspaceWithArticles(context, { days: 1 })
  },
  component: TodayPage,
})

function TodayPage() {
  const data = Route.useLoaderData()

  return (
    <RSSShell
      initialData={{ folders: data.folders, feeds: data.feeds, articles: data.articles }}
      title="Today"
      skipDateFilter
      articleDays={1}
    />
  )
}
