import { useState } from "react"
import { Link, createFileRoute, useRouter } from "@tanstack/react-router"
import { ArrowRight } from "lucide-react"
import { toast } from "sonner"
import type { ArticleRow } from "@/components/ArticleGrid"
import type { FeedRow } from "@/components/Sidebar"
import { RSSShell } from "@/components/RSSShell"
import { getAllData, refreshAllFeeds } from "@/server/rss"
import { getHomeData } from "@/server/home"
import { getCatalogue } from "@/server/catalogue"
import {
  DiscoverCatalogue,
  useOwnedFeedUrls,
} from "@/components/discover/DiscoverCatalogue"
import { HomeHero } from "@/components/home/HomeHero"
import { HomeRow } from "@/components/home/HomeRow"
import { DestinationTiles } from "@/components/home/DestinationTiles"
import { useReaderStore } from "@/store/readerStore"

/**
 * The landing page.
 *
 * This used to be the flat wall of every article ever fetched, which answered
 * "what exists" and nothing else: no grouping, no sense of what changed, and
 * on a new account a heading reading "Nothing here yet". The wall still exists
 * at /all, where an undifferentiated list is the right tool. Home is the
 * briefing.
 */
export const Route = createFileRoute("/_protected/")({
  loader: async () => {
    /*
      Parallel, with the race detected rather than prevented.

      These used to run one after the other, and for a real reason: `getAllData`
      seeds the demo workspace and creates a first folder for a genuinely new
      account, `getHomeData` reads those rows, and run together Home could
      render its empty state against a workspace that was still being created.

      But that race can only happen once in the life of a workspace, and paying
      for it serially charged a second full round trip to every load of the
      busiest page in the app, forever. So they go together, and the one case
      that could go wrong is checked for afterwards: a workspace that turned out
      to have feeds while Home counted none is a Home that read too early, and
      is simply asked again.
    */
    const [data, firstLook] = await Promise.all([getAllData(), getHomeData()])
    const home =
      firstLook.totalSourceCount === 0 && data.feeds.length > 0
        ? await getHomeData()
        : firstLook

    // Only pay for the catalogue when there is nothing to brief on.
    const catalogue = home.totalSourceCount === 0 ? await getCatalogue() : null
    return { data, home, catalogue }
  },
  staleTime: 30_000,
  component: HomePage,
})

/** Feed name and display domain, which the article rows render but do not store. */
function enrich(articles: Array<ArticleRow>, feeds: Array<FeedRow>): Array<ArticleRow> {
  const names = new Map(feeds.map((f) => [f.id, f.name]))
  return articles.map((article) => ({
    ...article,
    feedName: article.feedId ? names.get(article.feedId) : undefined,
    domain: (() => {
      try {
        return new URL(article.link).hostname.replace(/^www\./, "")
      } catch {
        return article.link
      }
    })(),
  }))
}

/**
 * Collapses a story arriving from more than one feed.
 *
 * A site's main feed carries what its section feeds carry, so subscribing to
 * "The Verge" plus "Tech" shows popular stories two or three times over. Home
 * is mostly short rows, where a duplicate costs a far larger share of the row
 * than it does in a wall.
 */
function dedupeByLink(articles: Array<ArticleRow>): Array<ArticleRow> {
  const seen = new Set<string>()
  return articles.filter((article) => {
    if (!article.link) return true
    if (seen.has(article.link)) return false
    seen.add(article.link)
    return true
  })
}

/** At most one card per source, so the hero shows three publishers not three posts. */
function pickDistinctSources(articles: Array<ArticleRow>, limit: number): Array<ArticleRow> {
  const used = new Set<string>()
  const picked: Array<ArticleRow> = []
  for (const article of articles) {
    const key = article.feedId ?? article.link
    if (used.has(key)) continue
    used.add(key)
    picked.push(article)
    if (picked.length === limit) break
  }
  return picked
}

/** Stories the hero card cycles through. */
const HERO_SLIDES = 3
const LEAD_ROW_CARDS = 12

function HomePage() {
  const { data, home, catalogue } = Route.useLoaderData()
  const router = useRouter()
  const ownedUrls = useOwnedFeedUrls(data.feeds)
  const favorites = useReaderStore((s) => s.favorites)
  const [refreshing, setRefreshing] = useState(false)

  const feeds = data.feeds as Array<FeedRow>
  const latest = dedupeByLink(enrich(home.latest, feeds))

  /*
    The carousel needs an image to be worth its size, so it draws from the
    subset that has one. If none do it simply renders nothing and the hero
    becomes a single column, which is better than three grey rectangles.
  */
  const heroSlides = pickDistinctSources(
    latest.filter((a) => a.image),
    HERO_SLIDES,
  )
  /*
    The row takes what the hero did not. Without the exclusion the same story
    is the first thing on the page twice over, which is the failure the dedupe
    above exists to prevent.
  */
  const heroIds = new Set(heroSlides.map((a) => a.id))
  const leadRow = latest.filter((a) => !heroIds.has(a.id)).slice(0, LEAD_ROW_CARDS)

  const lastFetchedAt = home.sources.reduce<string | null>((newest, source) => {
    if (!source.lastFetchedAt) return newest
    return !newest || source.lastFetchedAt > newest ? source.lastFetchedAt : newest
  }, null)

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await refreshAllFeeds()
      await router.invalidate()
    } catch (err) {
      console.error(err)
      toast.error("Could not refresh your feeds. Please try again.")
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <RSSShell
      initialData={{
        folders: data.folders,
        feeds: data.feeds,
        // The loader types this `any[]`; the shell needs the enriched shape.
        articles: data.articles as Array<ArticleRow>,
      }}
      title="Home"
    >
      {/*
        No scroll container of its own — the document scrolls. See the same
        note on /discover: any non-visible overflow here would re-anchor every
        sticky descendant, and the failure is silent.
      */}
      <div className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-10 px-6 pt-6 pb-12">
        {catalogue ? (
          /*
            A workspace with no sources cannot be briefed, so the page becomes
            the thing that fixes that. Kept close to what the old empty state
            said, on the assumption that the proper first-run flow is its own
            piece of work.
          */
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-50">
              Let's find you something to read
            </h1>
            <p className="mt-1 mb-8 text-sm text-zinc-400">
              Pick a few sources and this becomes your feed. Add a whole
              collection, or just the one you want.
            </p>
            <DiscoverCatalogue
              catalogue={catalogue}
              ownedUrls={ownedUrls}
              onImported={() => void router.invalidate()}
              variant="empty"
            />
          </div>
        ) : (
          <>
            <HomeHero
              featured={heroSlides}
              sources={home.sources}
              newCount={home.newCount}
              activeSourceCount={home.activeSourceCount}
              totalSourceCount={home.totalSourceCount}
              lastFetchedAt={lastFetchedAt}
              refreshing={refreshing}
              onRefresh={() => void handleRefresh()}
              onSourcesChanged={() => void router.invalidate()}
            />

            <HomeRow
              title="Fresh today"
              href="/all"
              articles={leadRow}
              wide
            />

            <DestinationTiles
              newCount={home.newCount}
              favoritesCount={favorites.length}
            />

            {home.sections.map((section) => (
              <HomeRow
                key={section.id ?? "ungrouped"}
                title={section.name}
                href={section.href}
                newCount={section.newCount}
                articles={enrich(section.articles as Array<ArticleRow>, feeds)}
              />
            ))}

            {/*
              The bottom of the page is where the person who has finished
              scanning decides whether to close the tab.
            */}
            <Link
              to="/discover"
              className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-white/10
                px-4 py-5 text-sm text-zinc-500 transition-colors hover:border-white/20 hover:text-zinc-200"
            >
              Nothing left? Browse the source catalogue
              <ArrowRight className="size-4" />
            </Link>
          </>
        )}
      </div>
    </RSSShell>
  )
}
