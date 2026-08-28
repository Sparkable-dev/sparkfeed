import { createFileRoute, redirect, useRouter } from "@tanstack/react-router"
import { getAllData } from "@/server/rss"
import { getCatalogue } from "@/server/catalogue"
import { RSSShell } from "@/components/RSSShell"
import { CategoryDetail } from "@/components/discover/CategoryDetail"
import { CategorySwitcher } from "@/components/discover/CategorySwitcher"
import { useOwnedFeedUrls } from "@/components/discover/DiscoverCatalogue"

export const Route = createFileRoute("/_protected/discover/$categorySlug")({
  loader: async ({ params }) => {
    const [data, catalogue] = await Promise.all([getAllData(), getCatalogue()])
    const category = catalogue.find((c) => c.slug === params.categorySlug)
    // A stale bookmark or a retired category would otherwise render a blank page.
    if (!category) throw redirect({ to: "/discover" })
    return { data, catalogue, category }
  },
  component: CategoryPage,
})

function CategoryPage() {
  const { data, catalogue, category } = Route.useLoaderData()
  const router = useRouter()
  const ownedUrls = useOwnedFeedUrls(data.feeds)

  return (
    <RSSShell
      initialData={{
        folders: data.folders,
        feeds: data.feeds,
        articles: data.articles as any,
      }}
      /* Renders as "Discover › Gaming", with Discover linking back. */
      crumbs={[{ label: "Discover", href: "/discover" }]}
      title={category.name}
      titleMenu={
        <CategorySwitcher
          categories={catalogue.map((c) => ({ slug: c.slug, name: c.name }))}
          activeSlug={category.slug}
        />
      }
    >
      {/*
        No category strip here. It exists on /discover to move between fifteen
        rows on one page; inside a single category it is a switcher for a place
        you have already arrived at, and it pushed the heading below the fold.
      */}
      <div className="min-w-0 flex-1 py-8">
        <div className="mx-auto w-full min-w-0 max-w-5xl px-6">
          <CategoryDetail
            category={category}
            ownedUrls={ownedUrls}
            onImported={() => void router.invalidate()}
          />
        </div>
      </div>
    </RSSShell>
  )
}
