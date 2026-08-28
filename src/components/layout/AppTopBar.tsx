import { useState } from "react"
import { Link } from "@tanstack/react-router"
import { ChevronRight, MoreHorizontal, Search, X } from "lucide-react"
import type { Crumb, HeaderAction } from "./header-actions"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { CommandPaletteTrigger } from "@/components/command/CommandPaletteTrigger"

/**
 * The app's one top bar.
 *
 * Three fixed regions — breadcrumb, command palette, page actions — and only
 * the third varies by page. Before this, the bar was three different bars
 * chosen by whether the route happened to pass `children`, which is how
 * `/discover` ended up with a kilopixel of empty header and how the folder
 * management menu ended up mobile-only.
 *
 * Both the crumb chain and the action list are described once and projected
 * twice, at desktop and at mobile widths. See `header-actions.tsx` for why.
 */
export function AppTopBar({
  crumbs,
  crumbMenu,
  actions = [],
  showSidebarTrigger = true,
  showPalette = true,
}: {
  crumbs: Array<Crumb>
  /** Dropdown glued to the leaf crumb — manage/share/rename, or a switcher. */
  crumbMenu?: React.ReactNode
  actions?: Array<HeaderAction>
  /** False on pages with no app sidebar to toggle, e.g. /settings. */
  showSidebarTrigger?: boolean
  /**
   * The trigger renders nothing outside a provider anyway, so this is only
   * needed where a palette exists but should not be offered — guest share.
   */
  showPalette?: boolean
}) {
  /*
    Owned here rather than by the page: expanding the search field is a
    property of how this bar lays itself out at a given width, and nothing
    outside the bar can act on it.
  */
  const [searchOpen, setSearchOpen] = useState(false)

  const search = actions.find((a) => a.kind === "search")
  const buttons = actions.filter((a) => a.kind === "button")
  /* Everything that cannot usefully shrink to a 32px icon. */
  const overflow = actions.filter((a) => a.kind === "note" || a.kind === "custom")

  const leaf = crumbs.at(-1)

  const closeSearch = () => {
    setSearchOpen(false)
    search?.onChange("")
  }

  return (
    <header
      className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-3 border-b border-zinc-800/60
        bg-[#0d0d0d]/95 px-3 backdrop-blur-sm
        lg:grid lg:grid-cols-[minmax(0,1fr)_auto_1fr]"
      /*
        A grid, not `justify-between`, so the palette is centred against the
        viewport instead of wherever the breadcrumb happens to end. The left
        track is `minmax(0,1fr)` and not `1fr` on purpose: a plain `1fr` keeps
        an auto minimum, so one long folder name would shove the centre column
        off-centre. The right track keeps its auto minimum, so actions are
        never the thing that gets crushed.

        Height is pinned at h-12 (48px): `CategoryNav` hardcodes `sticky
        top-12` to sit directly under this bar.
      */
    >
      {/* ── Left: sidebar toggle + breadcrumb ────────────────────────── */}
      <div className="flex min-w-0 items-center gap-2">
        {showSidebarTrigger && <SidebarTrigger className="shrink-0" />}

        {/*
          Mobile hides the whole chain and keeps the leaf. A phone has no room
          for "Technology › The Verge" beside three controls, and the ancestor
          is one back-swipe away.
        */}
        {/*
          An open search field takes the whole bar on a phone and there is
          nowhere for the crumb to go. On a desktop there is room for both, so
          this hides at one width and not the other.
        */}
        <div
          className={cn(
            "min-w-0 items-center gap-1.5",
            searchOpen ? "hidden md:flex" : "flex",
          )}
        >
            {crumbs.map((crumb, i) => {
              const isLeaf = i === crumbs.length - 1
              if (isLeaf) return null
              return (
                <div key={i} className="hidden min-w-0 shrink items-center gap-1.5 md:flex">
                  {crumb.href ? (
                    <Link
                      to={crumb.href}
                      className="truncate text-sm font-medium text-zinc-400 transition-colors hover:text-white"
                    >
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className="truncate text-sm font-medium text-zinc-400">
                      {crumb.label}
                    </span>
                  )}
                  <ChevronRight className="size-3.5 shrink-0 text-zinc-700" />
                </div>
              )
            })}

            {leaf && (
              <div className="flex min-w-0 items-center gap-1">
                <span className="truncate text-sm font-semibold text-zinc-100">
                  {leaf.label}
                </span>
                {crumbMenu}
              </div>
            )}
        </div>
      </div>

      {/* ── Centre: command palette (desktop only) ───────────────────── */}
      {/*
        Sized so the two `1fr` side tracks stay wider than the action cluster.
        They are equal by construction, so an over-wide centre starves both —
        and because the right one is right-aligned, it starves by overlapping
        the palette rather than by clipping.
      */}
      <div className="hidden lg:flex lg:w-80 lg:max-w-full lg:justify-center">
        {showPalette && <CommandPaletteTrigger />}
      </div>

      {/* ── Right: page actions ──────────────────────────────────────── */}
      <div
        className={cn(
          "flex items-center gap-1.5 lg:justify-end",
          /*
            No `min-w-0` here when closed, deliberately. This is the grid's
            third track, whose `1fr` sizing bottoms out at the content's
            min-content width — unless `min-w-0` removes that floor, at which
            point the track shrinks below the buttons and the whole cluster
            bleeds leftward over the palette. The breadcrumb is the thing that
            should truncate; the actions are not.
          */
          searchOpen
            ? "min-w-0 flex-1 lg:flex-none"
            : "ml-auto shrink-0 lg:ml-0",
        )}
      >
        {search && searchOpen ? (
          <>
            <div className="relative min-w-0 flex-1 md:w-64 md:flex-none">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-zinc-500" />
              <Input
                id={search.id}
                autoFocus
                placeholder={search.placeholder}
                value={search.value}
                onChange={(e) => search.onChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") closeSearch()
                }}
                className="h-8 w-full rounded-lg border-zinc-700/60 bg-zinc-900/40 pl-9 text-xs text-white
                  transition-all placeholder:text-zinc-600 focus-visible:border-blue-500/50
                  focus-visible:ring-blue-500/30"
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={closeSearch}
              className="size-8 shrink-0 text-zinc-400 hover:bg-white/10 hover:text-white"
              title="Close search"
            >
              <X className="size-4" />
            </Button>
          </>
        ) : (
          <>
            {/*
              Inline only at `lg`. Below that the sidebar still occupies 256px
              while the viewport does not, so a tablet has less room for the
              bar than a phone does — status text and dropdowns move into the
              overflow menu rather than pushing the page into a sideways scroll.
            */}
            {overflow.map((action) => (
              <div key={action.id} className="hidden shrink-0 items-center lg:flex">
                {action.kind === "note" ? (
                  <span className="text-[11px] whitespace-nowrap text-zinc-500 tabular-nums">
                    {action.text}
                  </span>
                ) : (
                  action.node
                )}
              </div>
            ))}

            {search && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSearchOpen(true)}
                className="size-8 shrink-0 text-zinc-400 hover:bg-white/10 hover:text-white"
                title="Search articles"
              >
                <Search className="size-4" />
              </Button>
            )}

            {buttons.map((action) => {
              const Icon = action.icon
              const primary = action.variant === "primary"
              return (
                <Button
                  key={action.id}
                  id={action.id}
                  size={primary ? "sm" : "icon"}
                  variant={primary ? "default" : "ghost"}
                  onClick={action.onClick}
                  disabled={action.disabled || action.busy}
                  title={action.label}
                  className={cn(
                    "shrink-0",
                    primary
                      ? "h-8 gap-1.5 bg-white text-xs font-semibold text-black hover:bg-zinc-200"
                      : "size-8 text-zinc-400 hover:bg-white/10 hover:text-white",
                  )}
                >
                  <Icon className={cn("size-4", action.busy && "animate-spin")} />
                  {/* The label is the button on desktop and the tooltip on mobile. */}
                  {primary && <span className="hidden md:inline">{action.label}</span>}
                </Button>
              )
            })}

            {/*
              Narrow-only overflow. Everything that renders inline on desktop
              but is too wide for a phone lands here, so no action is ever
              reachable at one width and not the other.
            */}
            {overflow.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label="More"
                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-md
                    text-zinc-400 transition-colors hover:bg-white/10 hover:text-white lg:hidden"
                >
                  <MoreHorizontal className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="min-w-[200px] rounded-xl border border-zinc-700/60 bg-[#0a0a0a] p-1 text-zinc-200 shadow-2xl"
                >
                  {overflow.map((action) =>
                    action.kind === "note" ? (
                      <div
                        key={action.id}
                        className="px-3 py-1.5 text-xs text-zinc-500 tabular-nums"
                      >
                        {action.text}
                      </div>
                    ) : (
                      <DropdownMenuItem
                        key={action.id}
                        className="rounded-lg px-1 py-1 focus:bg-transparent"
                      >
                        {action.node}
                      </DropdownMenuItem>
                    ),
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        )}
      </div>
    </header>
  )
}
