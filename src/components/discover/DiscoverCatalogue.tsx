import { useMemo, useState } from "react"
import { Link } from "@tanstack/react-router"
import { ArrowRight, Layers } from "lucide-react"
import { SourceIcon } from "./SourceIcon"
import { AddCatalogueButton } from "./AddCatalogueButton"
import { CategoryRow } from "./CategoryRow"
import { CataloguePreviewDialog } from "./CataloguePreviewDialog"
import type {
  CatalogueCard,
  CatalogueCardFeed,
  CatalogueCategoryView,
} from "@/server/services/catalogue"
import { normalizeFeedUrl } from "@/lib/validation"

/**
 * The Discover catalogue: categories of collections and feeds a user can add.
 *
 * Each category is a horizontal row (see CategoryRow). Collections come first
 * and are roughly twice as wide with a colour wash behind the header, so they
 * read as the anchor of the row without needing a label that says so; feed
 * cards stay deliberately lean, and the contrast is what carries the hierarchy.
 *
 * One component, two placements: the /discover page, and inline on / when the
 * workspace has no articles yet.
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
 * Card widths are fixed so the next card is always partly visible.
 *
 * Viewport units on small screens and pixels above `sm`: at 390px a card wants
 * most of the screen or it is unreadable, while at 1280px the same fraction
 * would show one enormous card. These are genuinely different numbers rather
 * than one value that works everywhere.
 */
const FEED_WIDTH = "w-[70vw] sm:w-[272px]"
const COLLECTION_WIDTH = "w-[78vw] sm:w-[420px]"

const CARD_BASE =
  "flex shrink-0 snap-start flex-col overflow-hidden rounded-xl border border-white/5 " +
  "bg-[#161616] transition-all duration-300 hover:-translate-y-1 hover:border-white/10 hover:shadow-2xl"

function FeedCard({
  feed,
  owned,
  onImported,
  onOpen,
}: {
  feed: CatalogueCardFeed
  owned: boolean
  onImported: () => void
  onOpen: () => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onOpen()
        }
      }}
      className={`${CARD_BASE} ${FEED_WIDTH} cursor-pointer gap-3 p-4 focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:outline-none`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <SourceIcon name={feed.name} slug={feed.slug} file={feed.iconFile} accent={feed.accent} />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold text-zinc-100">{feed.name}</span>
          <span className="truncate text-[11px] text-zinc-500">
            {domainOf(feed.siteUrl ?? feed.feedUrl)}
          </span>
        </div>
      </div>

      <p className="line-clamp-2 min-h-[2.5rem] text-xs leading-relaxed text-zinc-400">
        {feed.description}
      </p>

      {/* Stops the Add button from also opening the dialog behind it. */}
      <div
        className="mt-auto flex items-end justify-end pt-1"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <AddCatalogueButton
          kind="feed"
          slug={feed.slug}
          label="Add"
          alreadyAdded={owned}
          onImported={onImported}
        />
      </div>
    </div>
  )
}

function CollectionCard({
  card,
  ownedUrls,
  onImported,
  onOpen,
}: {
  card: Extract<CatalogueCard, { kind: "collection" }>
  ownedUrls: Set<string>
  onImported: () => void
  onOpen: () => void
}) {
  const missing = card.feeds.filter(
    (f) => !ownedUrls.has(normalizeFeedUrl(f.feedUrl) ?? f.feedUrl),
  )
  const allOwned = missing.length === 0
  const label = allOwned
    ? "Add"
    : missing.length === card.feeds.length
      ? "Add all"
      : `Add ${missing.length} more`

  const accent = card.accent ?? "#6366f1"

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onOpen()
        }
      }}
      className={`${CARD_BASE} ${COLLECTION_WIDTH} cursor-pointer focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:outline-none`}
    >
      {/*
        The wash is what makes a collection read as the anchor of the row. Kept
        low-opacity and behind the header only — a full-bleed colour panel would
        fight the article grid this page sits next to.
      */}
      <div
        className="relative flex items-center gap-3 px-4 pt-4 pb-3"
        style={{
          background: `linear-gradient(135deg, ${accent}26 0%, ${accent}0d 55%, transparent 100%)`,
        }}
      >
        <SourceIcon
          name={card.name}
          slug={card.slug}
          file={card.coverFile}
          accent={card.accent}
          size={48}
        />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-base font-bold tracking-tight text-zinc-50">
            {card.name}
          </span>
          <span className="inline-flex w-fit items-center gap-1 rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-zinc-300 uppercase">
            <Layers className="size-2.5" />
            {card.feeds.length} {card.feeds.length === 1 ? "feed" : "feeds"}
          </span>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 px-4 pt-1 pb-4">
        <p className="line-clamp-2 text-xs leading-relaxed text-zinc-400">
          {card.description}
        </p>

        {/* Naming the members so "Add all" is not a leap of faith. */}
        <div className="flex flex-wrap gap-1.5">
          {card.feeds.map((f) => (
            <span
              key={f.slug}
              className="inline-flex items-center gap-1.5 rounded-md border border-white/5 bg-white/[0.03] px-2 py-1 text-[10px] text-zinc-400"
            >
              <SourceIcon
                name={f.name}
                slug={f.slug}
                file={f.iconFile}
                accent={f.accent}
                size={14}
                className="rounded"
              />
              {f.name}
            </span>
          ))}
        </div>

        <div
          className="mt-auto flex items-end justify-end pt-1"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <AddCatalogueButton
            kind="collection"
            slug={card.slug}
            label={label}
            alreadyAdded={allOwned}
            onImported={onImported}
          />
        </div>
      </div>
    </div>
  )
}

export function DiscoverCatalogue({
  catalogue,
  ownedUrls,
  onImported,
  variant = "page",
}: {
  catalogue: Array<CatalogueCategoryView>
  /** The user's own feed URLs, normalised. Drives every "Added" state. */
  ownedUrls: Set<string>
  onImported: () => void
  variant?: "page" | "empty"
}) {
  /*
    One dialog for the whole page rather than one per card. A hundred mounted
    dialogs would each hold their own state and effects for a thing the user
    opens at most one of.
  */
  const [opened, setOpened] = useState<CatalogueCard | null>(null)

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-10">
        {catalogue.map((category) => (
          <section key={category.slug} id={`category-${category.slug}`} className="scroll-mt-16">
            <div className="mb-3 flex items-end justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-lg font-bold tracking-tight text-zinc-100">
                  {category.name}
                </h2>
                <p className="mt-0.5 text-xs text-zinc-500">{category.blurb}</p>
              </div>
              {variant === "empty" ? (
                <Link
                  to="/discover"
                  className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-zinc-400 transition-colors hover:text-white"
                >
                  Browse all
                  <ArrowRight className="size-3" />
                </Link>
              ) : (
                <Link
                  to="/discover/$categorySlug"
                  params={{ categorySlug: category.slug }}
                  className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-zinc-400 transition-colors hover:text-white"
                >
                  View more
                  <ArrowRight className="size-3" />
                </Link>
              )}
            </div>

            {/*
              No slicing by variant any more. A row shows what fits and the rest
              is a swipe away, so the inline placement on / can carry the whole
              category without making the page longer.
            */}
            <CategoryRow>
              {category.cards.map((card) =>
                card.kind === "collection" ? (
                  <CollectionCard
                    key={card.slug}
                    card={card}
                    ownedUrls={ownedUrls}
                    onImported={onImported}
                    onOpen={() => setOpened(card)}
                  />
                ) : (
                  <FeedCard
                    key={card.slug}
                    feed={card}
                    owned={ownedUrls.has(normalizeFeedUrl(card.feedUrl) ?? card.feedUrl)}
                    onImported={onImported}
                    onOpen={() => setOpened(card)}
                  />
                ),
              )}
            </CategoryRow>
          </section>
        ))}
      </div>

      <CataloguePreviewDialog
        card={opened}
        ownedUrls={ownedUrls}
        onOpenChange={(open) => {
          if (!open) setOpened(null)
        }}
        onImported={onImported}
      />
    </div>
  )
}

/**
 * Builds the "do I already have this" set once per render.
 *
 * The loader already fetches the workspace for the sidebar, and its feed
 * projection includes `url`, so this costs no extra query.
 */
export function useOwnedFeedUrls(feeds: Array<{ url: string }>): Set<string> {
  return useMemo(
    () => new Set(feeds.map((f) => normalizeFeedUrl(f.url) ?? f.url)),
    [feeds],
  )
}
