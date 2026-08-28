import { ExternalLink, Layers, Rss } from "lucide-react"
import { SourceIcon } from "./SourceIcon"
import { AddCatalogueButton } from "./AddCatalogueButton"
import { CatalogueArticleRow } from "./CatalogueArticleCard"
import { useCataloguePreview } from "./use-catalogue-preview"
import type { PreviewFeed } from "@/server/services/catalogue-preview"
import type { CatalogueCard, CatalogueCardFeed } from "@/server/services/catalogue"
import { copyText } from "@/lib/clipboard"
import { normalizeFeedUrl } from "@/lib/validation"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"

/**
 * What a Discover card looks like from the inside.
 *
 * Until this existed, adding a source meant judging it by a name and two lines
 * of description — which is not a decision anyone makes willingly. Showing the
 * last few headlines turns Add from a guess into a reaction.
 *
 * Deliberately narrow, and a list rather than a carousel. The question being
 * answered here is "is this any good", which is scanning, not browsing: a column
 * of headlines answers it without moving, where a row of image cards needs a
 * wide modal and a horizontal drag to see past the third one. The carousel lives
 * on the category page, where there is real width and browsing is the point.
 *
 * A collection stacks one list per member feed rather than merging them, because
 * the thing being judged is the collection's *composition*: "three Verge feeds"
 * only means something if you can see that they differ.
 */

/** Enough to judge a source; more is just scrolling. */
const PER_FEED_LIMIT = 6

function domainOf(url: string | null): string {
  if (!url) return ""
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return ""
  }
}

/**
 * Where the "visit" link should point for one member feed.
 *
 * Curation resolves `siteUrl` from whatever the entry was authored with, so for
 * a fair number of members it has ended up as the feed URL itself — clicking it
 * would drop the reader into raw XML. Falling back to the origin keeps the link
 * on a page a human can read, and the label is the domain either way.
 */
function visitUrl(feed: CatalogueCardFeed): string | null {
  if (feed.siteUrl && feed.siteUrl !== feed.feedUrl) return feed.siteUrl
  try {
    return new URL(feed.feedUrl).origin
  } catch {
    return feed.siteUrl
  }
}

const CHIP =
  "inline-flex shrink-0 items-center gap-1 rounded-md border border-white/10 bg-white/5 " +
  "px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:text-zinc-100"

/**
 * Chip labels are desktop-only.
 *
 * The dialog is 92vw on a phone, and a member row has to hold a name, two links
 * and an Add. Something has to give, and the two icons are self-explanatory
 * where a truncated feed name is not. Viewport breakpoints work here because the
 * dialog is capped at 520px: below `sm` it is always the narrow case.
 */
const CHIP_LABEL = "hidden max-w-[10rem] truncate sm:inline"

function FeedSection({
  feed,
  preview,
  loading,
  showHeader,
  owned,
  onImported,
}: {
  feed: CatalogueCardFeed
  preview: PreviewFeed | undefined
  loading: boolean
  showHeader: boolean
  owned: boolean
  onImported: () => void
}) {
  const visit = visitUrl(feed)

  return (
    <section className="min-w-0">
      {showHeader && (
        /*
          A collection member gets the same three affordances the dialog gives a
          standalone feed — where it publishes, its RSS URL, and an Add. Without
          them the only visible link was the collection's own `siteUrl`, which
          for something like Google AI is one member's domain standing in for
          two, so the dialog claimed a source it was not showing.
        */
        <div className="mb-1.5 flex min-w-0 items-center gap-1.5 px-2">
          <SourceIcon
            name={feed.name}
            slug={feed.slug}
            file={feed.iconFile}
            accent={feed.accent}
            size={18}
            className="shrink-0 rounded"
          />
          {/*
            The name is the only thing here allowed to shrink. Everything else is
            fixed-width and `shrink-0`, so a long name truncates instead of
            wrapping the row — which is what "The Verge — Tech" was doing.
          */}
          <span className="min-w-0 truncate text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">
            {feed.name}
          </span>

          {visit && (
            <a
              href={visit}
              target="_blank"
              rel="noopener noreferrer"
              className={CHIP}
              title={visit}
            >
              <ExternalLink className="size-2.5 shrink-0" />
              <span className={CHIP_LABEL}>{domainOf(visit)}</span>
            </a>
          )}
          <button
            type="button"
            onClick={() => void copyText(feed.feedUrl, { successMessage: "Feed URL copied" })}
            className={CHIP}
            title={feed.feedUrl}
          >
            <Rss className="size-2.5 shrink-0" />
            <span className={CHIP_LABEL}>RSS</span>
          </button>

          <AddCatalogueButton
            kind="feed"
            slug={feed.slug}
            label="Add"
            alreadyAdded={owned}
            onImported={onImported}
            className="ml-auto"
            tone="chip"
          />
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-1">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-start gap-3 px-2 py-2">
              <div className="size-12 shrink-0 animate-pulse rounded-md bg-white/[0.04]" />
              <div className="flex flex-1 flex-col gap-1.5 pt-1">
                <div className="h-2.5 w-full animate-pulse rounded bg-white/[0.04]" />
                <div className="h-2.5 w-1/3 animate-pulse rounded bg-white/[0.04]" />
              </div>
            </div>
          ))}
        </div>
      ) : preview && preview.articles.length > 0 ? (
        <div className="flex flex-col">
          {preview.articles.slice(0, PER_FEED_LIMIT).map((article) => (
            <CatalogueArticleRow key={article.link} article={article} />
          ))}
        </div>
      ) : (
        /*
          Two different sentences on purpose. An empty feed is still worth
          adding and should not read as broken; a feed we could not reach is a
          fact the user deserves before they add it.
        */
        <p className="px-2 py-3 text-xs text-zinc-600">
          {preview?.state === "unavailable"
            ? "Could not read this feed just now."
            : "This feed has no posts yet."}
        </p>
      )}
    </section>
  )
}

export function CataloguePreviewDialog({
  card,
  ownedUrls,
  onOpenChange,
  onImported,
}: {
  /** Null closes the dialog. The host owns this state; there is no trigger. */
  card: CatalogueCard | null
  ownedUrls: Set<string>
  onOpenChange: (open: boolean) => void
  onImported: () => void
}) {
  const target = card ? { kind: card.kind, slug: card.slug } : null
  const { feeds, status } = useCataloguePreview(target, card !== null)

  const previewOf = (slug: string) => feeds.find((f) => f.slug === slug)
  const loading = status === "loading"

  const isCollection = card?.kind === "collection"
  const members: Array<CatalogueCardFeed> = !card ? [] : isCollection ? card.feeds : [card]

  const ownsFeed = (f: CatalogueCardFeed) =>
    ownedUrls.has(normalizeFeedUrl(f.feedUrl) ?? f.feedUrl)

  const missing = members.filter((f) => !ownsFeed(f))
  const allOwned = card !== null && missing.length === 0
  const addLabel = allOwned
    ? "Add"
    : missing.length === members.length
      ? members.length > 1
        ? "Add all"
        : "Add"
      : `Add ${missing.length} more`

  const accent = card?.accent ?? "#6366f1"
  /*
    Only a standalone feed gets a domain up here. A collection's `siteUrl` is a
    single URL standing in for several sources, so it reads as "this is what you
    are adding" while being at most one of them. Members carry their own links.
  */
  const primaryUrl = card && !isCollection ? visitUrl(card) : null

  return (
    <Dialog open={card !== null} onOpenChange={onOpenChange}>
      <DialogContent
        /*
          The primitive defaults to `grid` at `sm:max-w-sm`, which contains
          nothing and is far too narrow — both have to be overridden, and the
          replacement width is a reading measure rather than as-wide-as-it-fits.
        */
        className="flex max-h-[80vh] w-[92vw] flex-col overflow-hidden border-zinc-800 bg-zinc-950 p-0 text-white sm:max-w-[520px]"
      >
        {card && (
          <>
            <div
              className="min-w-0 shrink-0 px-5 pt-5 pb-4"
              style={{
                background: `linear-gradient(135deg, ${accent}1f 0%, ${accent}08 55%, transparent 100%)`,
              }}
            >
              <div className="flex min-w-0 items-start gap-3">
                <SourceIcon
                  name={card.name}
                  slug={card.slug}
                  file={isCollection ? card.coverFile : card.iconFile}
                  accent={card.accent}
                  size={40}
                />
                <div className="flex min-w-0 flex-1 flex-col gap-1 pr-6">
                  <DialogTitle className="truncate text-base font-bold tracking-tight text-zinc-50">
                    {card.name}
                  </DialogTitle>
                  <DialogDescription className="line-clamp-2 text-xs leading-relaxed text-zinc-400">
                    {card.description}
                  </DialogDescription>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {isCollection && (
                  <span className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-zinc-300 uppercase">
                    <Layers className="size-2.5" />
                    {card.feeds.length} {card.feeds.length === 1 ? "feed" : "feeds"}
                  </span>
                )}
                {primaryUrl && (
                  <a href={primaryUrl} target="_blank" rel="noopener noreferrer" className={CHIP}>
                    <ExternalLink className="size-2.5" />
                    {domainOf(primaryUrl)}
                  </a>
                )}
                {!isCollection && (
                  /*
                    The feed URL is the one thing a person evaluating an RSS
                    source actually wants to copy, and it is invisible everywhere
                    else in the product.
                  */
                  <button
                    type="button"
                    onClick={() =>
                      void copyText(card.feedUrl, { successMessage: "Feed URL copied" })
                    }
                    className={CHIP}
                    title={card.feedUrl}
                  >
                    <Rss className="size-2.5" />
                    Copy RSS URL
                  </button>
                )}
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-3">
              {members.map((feed) => (
                <FeedSection
                  key={feed.slug}
                  feed={feed}
                  preview={previewOf(feed.slug)}
                  loading={loading}
                  /* A single feed's name is already the dialog title. */
                  showHeader={isCollection}
                  owned={ownsFeed(feed)}
                  onImported={onImported}
                />
              ))}

              {status === "error" && (
                <p className="px-2 text-xs text-zinc-600">
                  Could not load recent articles. You can still add this source.
                </p>
              )}
            </div>

            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-zinc-800 bg-zinc-900/40 px-5 py-3">
              <span className="truncate text-[11px] text-zinc-500">
                {members.length === 1
                  ? "Adds one feed."
                  : `Adds ${members.length} feeds as a folder.`}
              </span>
              <AddCatalogueButton
                kind={card.kind}
                slug={card.slug}
                label={addLabel}
                alreadyAdded={allOwned}
                onImported={onImported}
                className="shrink-0"
              />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
