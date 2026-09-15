import { Link } from "@tanstack/react-router"
import { ChevronRight } from "lucide-react"
import type { ArticleRow } from "@/components/ArticleGrid"
import { ArticleCard } from "@/components/ArticleCard"
import { CategoryRow } from "@/components/discover/CategoryRow"

/**
 * One horizontal shelf of articles, with a heading that goes somewhere.
 *
 * A row per folder rather than one merged wall, because the folders are
 * structure the user built and the old home page threw it away: eight curated
 * sources interleaved by timestamp look exactly like eight random ones.
 *
 * The scroller is the catalogue's `CategoryRow`, unchanged. Its `page` variant
 * bleeds to the viewport edge on a phone and hangs its arrows outside the row,
 * both of which assume a `px-6` parent — which is what Home's container is.
 */

/** Wide enough for a 4:3 image and a two-line headline without crowding. */
const CARD_WIDTH = "w-[190px] sm:w-[215px]"

/** The lead row only. Bigger cards read as "start here" without a second style. */
const WIDE_CARD_WIDTH = "w-[240px] sm:w-[290px]"

export function HomeRow({
  title,
  href,
  newCount = 0,
  articles,
  wide = false,
}: {
  title: string
  href: string
  /** Published in the last 24 hours. Omitted from the heading when zero. */
  newCount?: number
  articles: Array<ArticleRow>
  wide?: boolean
}) {
  if (articles.length === 0) return null

  return (
    <section className="min-w-0">
      <div className="mb-3 flex min-w-0 items-baseline justify-between gap-3">
        <h2 className="min-w-0 truncate text-sm font-bold tracking-tight text-foreground dark:text-zinc-100">
          {title}
          {newCount > 0 && (
            <span className="ml-2 text-xs font-medium text-muted-foreground dark:text-zinc-500">
              {newCount} new
            </span>
          )}
        </h2>
        <Link
          to={href}
          className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-muted-foreground dark:text-zinc-500
            transition-colors hover:text-foreground dark:hover:text-zinc-100"
        >
          See all
          <ChevronRight className="size-3.5" />
        </Link>
      </div>

      <CategoryRow>
        {articles.map((article) => (
          /*
            `[&>*]:h-full` so cards in one row share a height. The card sizes
            itself from its grid cell everywhere else in the app; here the cell
            is this wrapper, and without it a one-line headline leaves a short
            card sitting next to a tall one.
          */
          <div
            key={article.id}
            className={`${wide ? WIDE_CARD_WIDTH : CARD_WIDTH} shrink-0 snap-start [&>*]:h-full`}
          >
            <ArticleCard article={article} />
          </div>
        ))}
      </CategoryRow>
    </section>
  )
}
