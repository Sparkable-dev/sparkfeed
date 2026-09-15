import { Link } from "@tanstack/react-router"
import { QuickActions } from "./QuickActions"
import { LatestCard } from "./LatestCard"
import { SourceTable } from "./SourceTable"
import type { ArticleRow } from "@/components/ArticleGrid"
import type { HomeSource } from "@/server/home"

/**
 * The bento block that opens the page.
 *
 * Left: who you are, what changed, four things you might do, and the state of
 * every source. Right: one full story, cycling. The split is the point — a
 * greeting on its own is decoration, but a greeting next to something worth
 * reading is the page already doing its job above the fold.
 *
 * The two columns are deliberately the same height, and the left one sets it.
 * The right absorbs the slack internally, growing the space its description
 * can use rather than pushing the row taller.
 *
 * Refresh controls live in the shared top bar.
 */

function greeting(hour: number): string {
  if (hour < 12) return "Good morning"
  if (hour < 18) return "Good afternoon"
  return "Good evening"
}

export function HomeHero({
  userName,
  featured,
  sources,
  newCount,
  activeSourceCount,
  totalSourceCount,
  onSourcesChanged,
}: {
  userName?: string
  /** Cycled in the card, one per source so three publishers show, not three posts. */
  featured: Array<ArticleRow>
  sources: Array<HomeSource>
  newCount: number
  activeSourceCount: number
  totalSourceCount: number
  onSourcesChanged: () => void
}) {
  const fullName = userName?.trim()

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-12">
      {/*
        Plain stacking, not `justify-between`. With three blocks rather than
        two, spreading them to the column's full height puts uneven gaps
        between things that belong together, and the column's height is
        supposed to be set by its content — the other side is what stretches.
      */}
      <div className="flex min-w-0 flex-col gap-4 lg:col-span-7">
        <div className="min-w-0">
          <h1 className="text-2xl leading-tight font-bold tracking-tight text-foreground dark:text-zinc-50 sm:text-3xl">
            {greeting(new Date().getHours())}
            {fullName ? "," : "."}
            {fullName && (
              <>
                <br />
                <span className="break-words text-muted-foreground dark:text-zinc-400">{fullName}</span>
              </>
            )}
          </h1>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <p className="text-sm text-muted-foreground dark:text-zinc-400">
              {newCount > 0 ? (
                <>
                  {/*
                    The number is the link. It is the most clicked thing on any
                    dashboard, and Today is exactly the page it describes.
                  */}
                  <Link
                    to="/today"
                    className="font-semibold text-foreground dark:text-zinc-100 underline-offset-4 hover:underline"
                  >
                    {newCount} new
                  </Link>{" "}
                  in the last 24 hours across {activeSourceCount}{" "}
                  {activeSourceCount === 1 ? "source" : "sources"}.
                </>
              ) : (
                <>
                  Nothing new in the last 24 hours. {totalSourceCount}{" "}
                  {totalSourceCount === 1 ? "source is" : "sources are"} watching.
                </>
              )}
            </p>

          </div>
        </div>

        <QuickActions />

        <SourceTable sources={sources} onChanged={onSourcesChanged} />
      </div>

      {/*
        Absolutely positioned inside its own grid cell on desktop, so this
        column fills the row without contributing to it. Left as a normal flow
        child it would push the row taller whenever the headline list happened
        to be longer than the source table, and then the *left* column carries
        the dead space instead. Only one side may set the height, and it is the
        side whose content cannot scroll.
      */}
      <div className="min-w-0 lg:relative lg:col-span-5">
        <div className="lg:absolute lg:inset-0">
          <LatestCard articles={featured} />
        </div>
      </div>
    </div>
  )
}
