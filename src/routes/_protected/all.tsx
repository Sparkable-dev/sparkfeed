import { createFileRoute, useRouter } from "@tanstack/react-router"
import { invalidateWorkspace } from "@/lib/workspace-query"
import { loadWorkspaceWithArticles } from "@/lib/article-query"
import { RSSShell } from "@/components/RSSShell"
import { getCatalogue } from "@/server/catalogue"
import {
  DiscoverCatalogue,
  useOwnedFeedUrls,
} from "@/components/discover/DiscoverCatalogue"

/**
 * Every article, in one stream.
 *
 * This was the landing page until Home took `/`. It is kept because a single
 * undifferentiated list is genuinely the right tool for some questions ("did I
 * miss anything at all"), and because search and the date filter operate over
 * the whole workspace here in a way no folder row can.
 */
export const Route = createFileRoute("/_protected/all")({
  loader: async ({ context }) => {
    const data = await loadWorkspaceWithArticles(context)
    // Recommend sources only to a workspace with no subscriptions.
    const catalogue = data.feeds.length === 0 ? await getCatalogue() : null
    return { ...data, catalogue }
  },
  component: AllArticlesPage,
})

function AllArticlesPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const ownedUrls = useOwnedFeedUrls(data.feeds)

  return (
    <RSSShell
      initialData={{ folders: data.folders, feeds: data.feeds, articles: data.articles, degraded: data.degraded }}
      title="All articles"
      filterArticles={(articles) => articles}
      emptyState={
        data.catalogue ? (
          <div className="mx-auto w-full min-w-0 max-w-6xl py-6">
            <div className="mb-10">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                Nothing here yet
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Pick a few sources and this becomes your feed. Add a whole
                collection, or just the one you want.
              </p>
            </div>
            <DiscoverCatalogue
              catalogue={data.catalogue}
              ownedUrls={ownedUrls}
              onImported={() => void invalidateWorkspace(router)}
              variant="empty"
            />
          </div>
        ) : undefined
      }
    />
  )
}
