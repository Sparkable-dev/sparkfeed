import { useEffect, useRef, useState } from "react"
import { ExternalLink, Heart, PanelRightOpen, Share2 } from "lucide-react"
import type { ArticleRow } from "@/components/ArticleGrid"
import { ArticleDetailsPanel } from "@/components/ArticleDetailsPanel"
import { ArticleThumb } from "@/components/ArticleThumb"
import { PreviewSheet } from "@/components/PreviewSheet"
import { useGuestShare } from "@/hooks/guest-share-context"
import { copyText } from "@/lib/clipboard"
import { toPlainText } from "@/lib/plain-text"
import { domainOf } from "@/lib/source-mark"
import { timeAgo } from "@/lib/time-ago"
import { toggleFavorite } from "@/server/rss"
import { useReaderStore } from "@/store/readerStore"

/**
 * One tall story card, cycling through the newest few.
 *
 * Called "Latest" rather than "Top" on purpose. There is no popularity signal
 * anywhere in the product — `visit_count` is never written and nothing records
 * an open — so recency is the only ranking available, and a card labelled
 * "top" would claim an editorial judgement the data cannot support.
 *
 * A single card rather than a cover with a list beneath it: this column is the
 * page's one full-size piece of content, and a headline list here duplicates
 * what the rows below already do better. The card carries the whole story
 * instead — image, headline, standfirst, and the same actions every other card
 * in the app offers.
 */

/** How long each story holds before the next one. */
const ADVANCE_MS = 7000

/** Never clamp the description below this, even in a short card. */
const MIN_DESCRIPTION_LINES = 2

/** Used where the card has no height of its own to divide up. See `useFittedLines`. */
const STACKED_DESCRIPTION_LINES = 5

/** Matches the `lg:` breakpoint at which the hero becomes two columns. */
const TWO_COLUMN = "(min-width: 1024px)"

function displayDomain(article: ArticleRow): string {
  return article.domain ?? domainOf(article.link)
}

function publishedIso(article: ArticleRow): string | null {
  if (typeof article.publishedAt === "string") return article.publishedAt
  return article.publishedAt?.toISOString() ?? null
}

/**
 * How many lines of description fit in the space left over.
 *
 * The card's height is set by the column beside it, which moves with the
 * number of sources, so a hardcoded `line-clamp-3` either leaves a gap or
 * spills. Measuring gives a real ellipsis at whatever height the card happens
 * to be, which is the behaviour "truncate when there is not enough room"
 * actually describes.
 *
 * Only at two columns, though, and that guard is load-bearing rather than an
 * optimisation. Below `lg` the hero is a stack, so the card has no height of
 * its own and the box takes whatever the paragraph needs — which means the
 * clamp sets the height it is supposed to be measuring. That loop settles at
 * the minimum and stays there: two lines, on every phone, whatever the card
 * had room for. A constant is the honest answer where there is nothing to
 * divide up.
 */
function useFittedLines(
  boxRef: React.RefObject<HTMLDivElement | null>,
  textRef: React.RefObject<HTMLParagraphElement | null>,
) {
  const [lines, setLines] = useState(STACKED_DESCRIPTION_LINES)

  useEffect(() => {
    const box = boxRef.current
    const text = textRef.current
    if (!box || !text) return

    const twoColumn = window.matchMedia(TWO_COLUMN)

    const measure = () => {
      if (!twoColumn.matches) {
        setLines(STACKED_DESCRIPTION_LINES)
        return
      }
      // `leading-relaxed` on the paragraph guarantees this resolves to px
      // rather than to the string "normal", which is not arithmetic.
      const lineHeight = parseFloat(getComputedStyle(text).lineHeight)
      if (!Number.isFinite(lineHeight) || lineHeight <= 0) return
      setLines(Math.max(MIN_DESCRIPTION_LINES, Math.floor(box.clientHeight / lineHeight)))
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    twoColumn.addEventListener("change", measure)
    return () => {
      observer.disconnect()
      twoColumn.removeEventListener("change", measure)
    }
  }, [boxRef, textRef])

  return lines
}

const ACTION =
  "flex size-7 items-center justify-center rounded-md border border-white/5 bg-white/5 " +
  "text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"

export function LatestCard({ articles }: { articles: Array<ArticleRow> }) {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)

  const boxRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLParagraphElement>(null)
  const lines = useFittedLines(boxRef, textRef)

  const guest = useGuestShare()
  // A boolean rather than the array — see the note in ArticleCard.
  const isStarred = useReaderStore((s) => s.favorites.includes(articles[Math.min(index, articles.length - 1)]?.id ?? ""))
  const toggleLocalFavorite = useReaderStore((s) => s.toggleFavorite)

  useEffect(() => {
    if (paused || articles.length < 2) return
    /*
      Auto-advance is motion nobody asked for, which is precisely what the OS
      setting exists to suppress. With it on, the dots still work.
    */
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

    const timer = setInterval(
      () => setIndex((i) => (i + 1) % articles.length),
      ADVANCE_MS,
    )
    return () => clearInterval(timer)
  }, [paused, articles.length])

  if (articles.length === 0) return null

  // The list can shrink under a stale index when the loader revalidates.
  const active = Math.min(index, articles.length - 1)
  const article = articles[active]
  const isFavorite = isStarred || !!article.isFavorite
  const description = toPlainText(article.description)

  const handleFavorite = async () => {
    toggleLocalFavorite(article.id)
    // A guest has no workspace, so the server call resolves nothing and
    // throws. Their favourites still work, they just stay on this device.
    if (guest) return
    try {
      await toggleFavorite({ data: { id: article.id, state: !isFavorite } })
    } catch {
      toggleLocalFavorite(article.id)
    }
  }

  return (
    <>
      <div
        className="flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-[#161616]"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocusCapture={() => setPaused(true)}
        onBlurCapture={() => setPaused(false)}
      >
        <button
          type="button"
          onClick={() => setPreviewOpen(true)}
          aria-label={article.title}
          className="group relative aspect-[16/10] w-full shrink-0 overflow-hidden bg-zinc-900"
        >
          {/*
            Every image stays mounted and cross-fades. Swapping a single `src`
            re-downloads on each loop and flashes white between stories.
          */}
          {articles.map((item, i) => (
            <div
              key={item.id}
              className={`absolute inset-0 transition-opacity duration-700 ${
                i === active ? "opacity-100" : "opacity-0"
              }`}
            >
              <ArticleThumb
                src={item.image}
                link={item.link}
                name={item.feedName}
                scale="lg"
              />
            </div>
          ))}

          <span className="absolute bottom-3 left-3 rounded-full border border-white/10 bg-black/60 px-2.5 py-1 text-[9px] font-bold tracking-wider text-white/90 uppercase backdrop-blur-md">
            {displayDomain(article)}
          </span>
        </button>

        <div className="flex min-h-0 flex-1 flex-col gap-2 p-4">
          <div className="flex items-start justify-between gap-3">
            <span className="text-[10px] text-zinc-500">
              {timeAgo(publishedIso(article))}
            </span>
            {/*
              Outside the image, unlike the grid card. Over a photo it needs a
              scrim to stay visible at all; here it sits on a flat surface and
              simply reads.
            */}
            <button
              type="button"
              onClick={() => void handleFavorite()}
              aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
              className="-mt-0.5 shrink-0 transition-transform hover:scale-110 active:scale-95"
            >
              <Heart
                className="size-4"
                style={{
                  fill: isFavorite ? "#ef4444" : "transparent",
                  color: isFavorite ? "#ef4444" : "#71717a",
                }}
              />
            </button>
          </div>

          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="line-clamp-3 text-left text-[15px] leading-snug font-bold text-white
              transition-colors hover:text-zinc-300"
          >
            {article.title}
          </button>

          {/*
            The box owns the leftover height and the paragraph is measured
            against it, so the clamp is whatever actually fits. See
            `useFittedLines`.
          */}
          <div
            ref={boxRef}
            /*
              The cap is for phones only. There the hero is a stack rather than
              a two-column row, so the card has no height to fill and the box
              would simply take whatever the summary needed — which for a feed
              that ships a full first paragraph is most of a screen before you
              reach anything else.
            */
            className="max-h-32 min-h-0 flex-1 overflow-hidden lg:max-h-none"
          >
            {description && (
              <p
                ref={textRef}
                className="overflow-hidden text-xs leading-relaxed text-zinc-400"
                style={{
                  display: "-webkit-box",
                  WebkitBoxOrient: "vertical",
                  WebkitLineClamp: lines,
                }}
              >
                {description}
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={() => setDetailsOpen(true)}
              className={ACTION}
              title="Article details"
              aria-label="Show article details"
            >
              <PanelRightOpen className="size-3" />
            </button>
            <button
              type="button"
              onClick={() =>
                void copyText(article.link, { successMessage: "Link copied" })
              }
              className={ACTION}
              title="Share article"
              aria-label="Copy article link"
            >
              <Share2 className="size-3" />
            </button>
            <a
              href={article.link}
              target="_blank"
              rel="noopener noreferrer"
              className={ACTION}
              title="Open in new tab"
              aria-label="Open in new tab"
            >
              <ExternalLink className="size-3" />
            </a>
          </div>

          {articles.length > 1 && (
            <div className="flex items-center justify-center gap-1.5 pt-1">
              {articles.map((item, i) => (
                <button
                  key={item.id}
                  type="button"
                  aria-label={`Show story ${i + 1} of ${articles.length}`}
                  aria-current={i === active}
                  onClick={() => setIndex(i)}
                  className={`h-1.5 rounded-full transition-all ${
                    i === active ? "w-5 bg-white" : "w-1.5 bg-white/25 hover:bg-white/50"
                  }`}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <PreviewSheet
        article={previewOpen ? article : null}
        onClose={() => setPreviewOpen(false)}
      />
      <ArticleDetailsPanel
        article={detailsOpen ? article : null}
        onClose={() => setDetailsOpen(false)}
        onRead={() => {
          setDetailsOpen(false)
          setPreviewOpen(true)
        }}
      />
    </>
  )
}
