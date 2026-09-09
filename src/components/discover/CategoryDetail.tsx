import { useEffect, useRef, useState } from "react"
import { Link } from "@tanstack/react-router"
import { ArrowLeft, ExternalLink, Layers } from "lucide-react"
import { SourceIcon } from "./SourceIcon"
import { AddCatalogueButton } from "./AddCatalogueButton"
import { CategoryRow } from "./CategoryRow"
import { CatalogueArticleCard } from "./CatalogueArticleCard"
import { useCataloguePreview } from "./use-catalogue-preview"
import type {
  CatalogueCard,
  CatalogueCardFeed,
  CatalogueCategoryView,
} from "@/server/services/catalogue"
import { normalizeFeedUrl } from "@/lib/validation"

/**
 * One category, laid out to be read rather than skimmed.
 *
 * The row on /discover is a shelf: it shows what exists and hides the articles
 * behind a dialog. This page inverts that — every source is expanded, so you can
 * judge a whole category in one scroll without opening anything.
 */

function domainOf(url: string | null): string {
  if (!url) return ""
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return ""
  }
}

/**
 * Fetches only once the row has been near the viewport.
 *
 * A category holds up to a dozen sources, and fetching all of them on mount
 * would mean a dozen feeds' worth of network before anything is readable.
 * Loading as you scroll costs nothing for the rows you never reach.
 */
function useNearViewport<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [near, setNear] = useState(false)

  useEffect(() => {
    if (near || !ref.current) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setNear(true)
      },
      // A screen of lead time, so a row is usually ready by the time it arrives.
      { rootMargin: "600px 0px" }
    )
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [near])

  return { ref, near }
}

function SourceBlock({
  card,
  ownedUrls,
  onImported,
}: {
  card: CatalogueCard
  ownedUrls: Set<string>
  onImported: () => void
}) {
  const { ref, near } = useNearViewport<HTMLDivElement>()
  const { feeds, status, retry } = useCataloguePreview(
    { kind: card.kind, slug: card.slug },
    near
  )

  const isCollection = card.kind === "collection"
  const members: Array<CatalogueCardFeed> = isCollection ? card.feeds : [card]

  const missing = members.filter(
    (f) => !ownedUrls.has(normalizeFeedUrl(f.feedUrl) ?? f.feedUrl)
  )
  const allOwned = missing.length === 0
  const label = allOwned
    ? "Add"
    : missing.length === members.length
      ? members.length > 1
        ? "Add all"
        : "Add"
      : `Add ${missing.length} more`

  const siteUrl = isCollection ? card.siteUrl : (card.siteUrl ?? null)
  const accent = card.accent ?? "#6366f1"

  return (
    <div
      ref={ref}
      className="rounded-xl border border-white/5 bg-[#121212] p-5"
      style={{
        backgroundImage: `linear-gradient(135deg, ${accent}14 0%, transparent 40%)`,
      }}
    >
      <div className="mb-4 flex min-w-0 items-start gap-3.5">
        <SourceIcon
          name={card.name}
          slug={card.slug}
          file={isCollection ? card.coverFile : card.iconFile}
          accent={card.accent}
          size={44}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-bold tracking-tight text-zinc-50">
              {card.name}
            </h3>
            {isCollection && (
              <span className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-zinc-300 uppercase">
                <Layers className="size-2.5" />
                {card.feeds.length} {card.feeds.length === 1 ? "feed" : "feeds"}
              </span>
            )}
            {siteUrl && (
              <a
                href={siteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-zinc-500 transition-colors hover:text-zinc-200"
              >
                <ExternalLink className="size-2.5" />
                {domainOf(siteUrl)}
              </a>
            )}
          </div>
          <p className="line-clamp-2 text-xs leading-relaxed text-zinc-400">
            {card.description}
          </p>
        </div>

        {!isCollection && card.sourceKind === "page" && (
          <span
            title="Articles collected from this website. No native feed used."
            className="self-center rounded border border-white/10 px-2 py-1 text-[11px] text-zinc-400"
          >
            Website
          </span>
        )}
        <AddCatalogueButton
          kind={card.kind}
          slug={card.slug}
          label={label}
          alreadyAdded={allOwned}
          onImported={onImported}
          className="shrink-0"
        />
      </div>

      {status === "loading" || !near ? (
        <div className="flex gap-4 overflow-hidden">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-[188px] w-[220px] shrink-0 animate-pulse rounded-lg bg-white/[0.04]"
            />
          ))}
        </div>
      ) : (
        /*
          One row per member feed, never merged. A collection's feeds are the
          thing being judged — "two Google AI feeds" only means something if you
          can see that DeepMind and Research publish different work. Merging them
          into a single row hid exactly the distinction the card advertises.
        */
        <div className="flex flex-col gap-5">
          {members.map((feed) => {
            const preview = feeds.find((f) => f.slug === feed.slug)
            return (
              <div key={feed.slug} className="min-w-0">
                {/* Only worth naming when there is more than one to tell apart. */}
                {members.length > 1 && (
                  <div className="mb-2 flex min-w-0 items-center gap-2">
                    <SourceIcon
                      name={feed.name}
                      slug={feed.slug}
                      file={feed.iconFile}
                      accent={feed.accent}
                      size={18}
                      className="rounded"
                    />
                    <span className="truncate text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">
                      {feed.name}
                    </span>

                    {/*
                      Add just this one. "Add all" is the common case but not the
                      only one — someone who wants The Verge's AI coverage and
                      not its main firehose had no way to say so.
                    */}
                    <AddCatalogueButton
                      kind="feed"
                      slug={feed.slug}
                      label="Add"
                      alreadyAdded={ownedUrls.has(
                        normalizeFeedUrl(feed.feedUrl) ?? feed.feedUrl
                      )}
                      onImported={onImported}
                      className="ml-auto shrink-0"
                      tone="secondary"
                    />
                  </div>
                )}

                {preview && preview.articles.length > 0 ? (
                  <div>
                    {preview.stale && (
                      <p className="mb-2 text-xs text-zinc-500">
                        Showing the last saved preview. This source could not be
                        refreshed.
                      </p>
                    )}
                    <CategoryRow variant="inset">
                      {preview.articles.map((article) => (
                        <CatalogueArticleCard
                          key={article.link}
                          article={article}
                        />
                      ))}
                    </CategoryRow>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 text-xs text-zinc-500">
                    <p>
                      {status === "error"
                        ? "Could not load this preview."
                        : preview?.state === "unavailable"
                          ? (preview.error ??
                            "We could not read this source just now.")
                          : "This source has no posts yet."}
                    </p>
                    {(status === "error" ||
                      preview?.state === "unavailable") && (
                      <button
                        onClick={retry}
                        className="text-zinc-300 underline underline-offset-4"
                        title="Retry preview; publisher requests have a five-minute cooldown"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function CategoryDetail({
  category,
  ownedUrls,
  onImported,
}: {
  category: CatalogueCategoryView
  ownedUrls: Set<string>
  onImported: () => void
}) {
  const sourceCount = category.cards.reduce(
    (n, card) => n + (card.kind === "collection" ? card.feeds.length : 1),
    0
  )

  return (
    <div className="flex flex-col">
      <div className="mb-8">
        {/*
          In the page, not only the breadcrumb: the top bar's breadcrumb is
          hidden below `md`, so on a phone this was a page with no exit other
          than the browser's own Back button.
        */}
        <Link
          to="/discover"
          className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-200"
        >
          <ArrowLeft className="size-3.5" />
          All categories
        </Link>

        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {category.name}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{category.blurb}</p>
        <p className="mt-2 text-xs text-zinc-600">
          {sourceCount} {sourceCount === 1 ? "source" : "sources"}
        </p>
      </div>

      <div className="flex flex-col gap-5">
        {category.cards.map((card) => (
          <SourceBlock
            key={card.slug}
            card={card}
            ownedUrls={ownedUrls}
            onImported={onImported}
          />
        ))}
      </div>
    </div>
  )
}
