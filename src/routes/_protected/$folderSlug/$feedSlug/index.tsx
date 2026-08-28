import { createFileRoute, redirect } from "@tanstack/react-router"
import { getAllData } from "@/server/rss"
import { RSSShell } from "@/components/RSSShell"
import { slugify } from "@/lib/slugify"

export const Route = createFileRoute("/_protected/$folderSlug/$feedSlug/")({
  loader: async ({ params }) => {
    const data = await getAllData()
    const folder = data.folders.find((f) => slugify(f.name) === params.folderSlug)
    const feed = data.feeds.find(
      (f) => slugify(f.name) === params.feedSlug && f.folderId === folder?.id
    )
    if (!feed) {
      throw redirect({ to: "/" })
    }
    return {
      ...data,
      folderSlug: params.folderSlug,
      feedSlug: params.feedSlug,
      folderId: folder?.id ?? null,
      feedId: feed.id,
      feedName: feed.name,
    }
  },
  component: FeedPage,
})

function FeedPage() {
  const data = Route.useLoaderData()
  const { feedSlug, feedName, feedId, folderId } = data

  if (!feedId) {
    return (
      <div className="flex h-screen items-center justify-center text-zinc-500 text-sm">
        Feed "{feedSlug}" not found.
      </div>
    )
  }

  const folder = data.folders.find((f) => f.id === folderId)

  return (
    <RSSShell
      initialData={{ folders: data.folders, feeds: data.feeds, articles: data.articles as any }}
      title={feedName || "Feed"}
      folderName={folder?.name}
      folderSlug={data.folderSlug}
      folderId={folderId ?? undefined}
      feedId={feedId}
      filterArticles={(articles) => articles.filter((a) => a.feedId === feedId)}
    />
  )
}
