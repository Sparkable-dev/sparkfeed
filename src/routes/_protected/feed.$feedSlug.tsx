import { createFileRoute, redirect } from "@tanstack/react-router"
import { loadWorkspaceData } from "@/lib/workspace-query"
import { articlePagesQuery } from "@/lib/article-query"
import { RSSShell } from "@/components/RSSShell"
import { slugify } from "@/lib/slugify"

export const Route = createFileRoute("/_protected/feed/$feedSlug")({
  loader: async ({ params, context }) => {
    const data = await loadWorkspaceData(context)
    // Look for a feed with matching slug that has NO folder
    const feed = data.feeds.find(
      (f) => slugify(f.name) === params.feedSlug && !f.folderId
    )
    if (!feed) {
      throw redirect({ to: "/" })
    }
    await context.queryClient.fetchInfiniteQuery(articlePagesQuery(context.workspaceScope, { feedId: feed.id }))
    return {
      ...data,
      feedSlug: params.feedSlug,
      feedId: feed.id,
      feedName: feed.name,
    }
  },
  component: StandaloneFeedPage,
})

function StandaloneFeedPage() {
  const data = Route.useLoaderData()
  const { feedSlug, feedName, feedId } = data

  if (!feedId) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground dark:text-zinc-500 text-sm">
        Standalone feed "{feedSlug}" not found.
      </div>
    )
  }

  return (
    <RSSShell
      initialData={{ folders: data.folders, feeds: data.feeds, articles: data.articles, degraded: data.degraded }}
      title={feedName || "Feed"}
      feedId={feedId}
      filterArticles={(articles) => articles.filter((a) => a.feedId === feedId)}
    />
  )
}
