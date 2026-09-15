import { Link } from "@tanstack/react-router"
import { CompassIcon, Heart, Sun, Telescope } from "lucide-react"

/**
 * Where to go next, with a reason attached.
 *
 * "Today" as a bare word is a sidebar row people have already learned to skip.
 * "Today · 41 new" is a number, and a number is the most clicked thing on any
 * dashboard. So every tile carries either a real count or a short line saying
 * what it is for, and never a fabricated one: `/all` gets a phrase rather than
 * a total because the wall applies a date filter and dedupes by link, so no
 * single number would match what it renders.
 */
export function DestinationTiles({
  newCount,
  favoritesCount,
}: {
  newCount: number
  favoritesCount: number
}) {
  const tiles = [
    {
      href: "/today",
      icon: Sun,
      label: "Today",
      detail: newCount > 0 ? `${newCount} new` : "Nothing new yet",
      tint: "text-amber-700 dark:text-amber-300",
    },
    {
      href: "/all",
      icon: CompassIcon,
      label: "All articles",
      detail: "Everything, one stream",
      tint: "text-blue-700 dark:text-blue-300",
    },
    {
      href: "/favorites",
      icon: Heart,
      label: "Favorites",
      detail: favoritesCount > 0 ? `${favoritesCount} saved` : "Nothing saved yet",
      tint: "text-rose-700 dark:text-rose-300",
    },
    {
      href: "/discover",
      icon: Telescope,
      label: "Discover",
      detail: "Find new sources",
      tint: "text-violet-700 dark:text-violet-300",
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((tile) => {
        const Icon = tile.icon
        return (
          <Link
            key={tile.href}
            to={tile.href}
            className="flex min-w-0 flex-col gap-2 rounded-xl border border-border dark:border-white/[0.07] bg-card dark:bg-white/[0.02] p-3.5
              transition-colors hover:border-border dark:hover:border-white/15 hover:bg-accent dark:hover:bg-white/[0.06]"
          >
            <Icon className={`size-4 shrink-0 ${tile.tint}`} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-foreground dark:text-zinc-100">
                {tile.label}
              </span>
              <span className="block truncate text-[11px] text-muted-foreground dark:text-zinc-500">
                {tile.detail}
              </span>
            </span>
          </Link>
        )
      })}
    </div>
  )
}
