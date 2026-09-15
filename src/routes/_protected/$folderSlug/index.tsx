import { createFileRoute, redirect } from "@tanstack/react-router"
import { loadWorkspaceData } from "@/lib/workspace-query"
import { articlePagesQuery } from "@/lib/article-query"
import { RSSShell } from "@/components/RSSShell"
import { slugify } from "@/lib/slugify"

export const Route = createFileRoute("/_protected/$folderSlug/")({
  loader: async ({ params, context }) => {
    const data = await loadWorkspaceData(context)
    const folder = data.folders.find((f) => slugify(f.name) === params.folderSlug)
    if (!folder) {
      throw redirect({ to: "/" })
    }
    await context.queryClient.fetchInfiniteQuery(articlePagesQuery(context.workspaceScope, { folderId: folder.id }))
    return { ...data, folderSlug: params.folderSlug, folderId: folder.id }
  },
  component: FolderPage,
})

function FolderPage() {
  const data = Route.useLoaderData()
  const { folderSlug, folderId } = data
  const folder = data.folders.find((f) => f.id === folderId)

  if (!folder) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground dark:text-zinc-500 text-sm">
        Folder "{folderSlug}" not found.
      </div>
    )
  }

  return (
    <RSSShell
      initialData={{ folders: data.folders, feeds: data.feeds, articles: data.articles }}
      title={folder.name}
      folderId={folder.id}
      filterArticles={(articles, feeds) => {
        const folderFeedIds = new Set(
          feeds.filter((f) => f.folderId === folder.id).map((f) => f.id)
        )
        return articles.filter((a) => a.feedId && folderFeedIds.has(a.feedId))
      }}
    />
  )
}
