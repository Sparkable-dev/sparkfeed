import { createFileRoute, useRouter } from "@tanstack/react-router"
import { getAllData } from "@/server/rss"
import { getCatalogue } from "@/server/catalogue"
import { RSSShell } from "@/components/RSSShell"
import { CategoryNav } from "@/components/discover/CategoryNav"
import { DiscoverHero } from "@/components/discover/DiscoverHero"
import {
  DiscoverCatalogue,
  useOwnedFeedUrls,
} from "@/components/discover/DiscoverCatalogue"

export const Route = createFileRoute("/_protected/discover/")({
  loader: async () => {
    // getAllData is for the sidebar, which RSSShell renders on every route.
    const [data, catalogue] = await Promise.all([getAllData(), getCatalogue()])
    return { data, catalogue }
  },
  component: DiscoverPage,
})

function DiscoverPage() {
  const { data, catalogue } = Route.useLoaderData()
  const router = useRouter()
  const ownedUrls = useOwnedFeedUrls(data.feeds)

  return (
    <RSSShell
      initialData={{
        folders: data.folders,
        feeds: data.feeds,
        articles: data.articles as any,
      }}
      title="Discover"
    >
      {/*
        No scroll container of its own. The document scrolls, and adding an
        overflow here would make this a scrollport that never moves — which is
        exactly what stops the category strip below from sticking.
      */}
      <div className="min-w-0 flex-1 pb-8">
        <div className="mx-auto w-full min-w-0 max-w-6xl px-6 pt-8">
          {/* The hero carries the page heading, so there is no second title. */}
          {/* No `folders` prop: the Add dialog fetches its own picker list. */}
          <DiscoverHero onFeedAdded={() => void router.invalidate()} />
        </div>

        {/*
          Outside the container on purpose: once pinned it needs to span the
          full content width, or its underline stops short of the edges and
          reads as a stray rule. It re-centres the chips itself.
        */}
        <CategoryNav
          categories={catalogue.map((c) => ({ slug: c.slug, name: c.name }))}
        />

        <div className="mx-auto w-full min-w-0 max-w-6xl px-6">
          <DiscoverCatalogue
            catalogue={catalogue}
            ownedUrls={ownedUrls}
            onImported={() => void router.invalidate()}
          />
        </div>
      </div>
    </RSSShell>
  )
}
