import { Link } from "@tanstack/react-router"
import { ChevronRight, Folder, GripVertical, RefreshCw } from "lucide-react"
import type { ReactNode } from "react"
import type { TreeFeed, TreeFolder } from "./source-tree"
import type { SourceStatus } from "@/lib/source-health"
import { formatGap, sourceStatus, typicalGapMs } from "@/lib/source-health"
import { timeAgo } from "@/lib/time-ago"
import { PageSourceDot } from "@/components/PageSourceDot"

/**
 * The two row shapes on `/sources`, and the grid they share.
 *
 * Presentational only: every action arrives as a prop so the page owns all the
 * state and these can be dragged, filtered or rendered in a drag overlay
 * without dragging their behaviour along with them.
 */

/*
  One grid declared once and applied to both row kinds and the column header, so
  a feed's "last post" always lines up under a folder's. The indent for feeds is
  padding on the row rather than a different grid, which is what keeps them
  aligned. The two middle columns drop below `sm`: a phone has room for a name,
  one date and the menu, and the cadence is the least useful of them.
*/
export const ROW_GRID =
  "grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-3 sm:grid-cols-[auto_1fr_5rem_5.5rem_auto]"

/**
 * One colour per state, shared with the overview chart above the table.
 *
 * Exported so a dot in the quadrant and the dot beside the same feed's name
 * cannot disagree about what amber means.
 */
export const STATUS_STYLE: Record<SourceStatus, { dot: string; label: string }> = {
  broken: { dot: "bg-amber-400", label: "Not fetching" },
  quiet: { dot: "bg-zinc-600", label: "Quiet" },
  new: { dot: "bg-blue-400/70", label: "New" },
  active: { dot: "bg-emerald-400/80", label: "Active" },
}

/**
 * The drag affordance.
 *
 * A real `<button>`, not a styled div: dnd-kit's keyboard sensor needs
 * something focusable to lift from, and that is the whole of the non-pointer
 * story. `cursor-grab` rather than `cursor-move` because the row is not moving
 * yet — it is waiting to be picked up.
 */
export function DragHandle({
  hidden,
  label,
  ...props
}: {
  hidden?: boolean
  label: string
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  if (hidden) {
    // Space is still reserved, so filtering the list does not shift every row
    // sideways by 20px.
    return <span aria-hidden="true" className="block size-5 shrink-0" />
  }
  return (
    <button
      type="button"
      aria-label={label}
      className="flex size-5 shrink-0 cursor-grab touch-none items-center justify-center rounded
        text-zinc-700 transition-colors hover:text-zinc-300 focus-visible:text-zinc-200
        focus-visible:outline-1 focus-visible:outline-white/40 active:cursor-grabbing"
      {...props}
    >
      <GripVertical className="size-3.5" />
    </button>
  )
}

export function SourcesColumnHeader() {
  return (
    <div
      className={`${ROW_GRID} border-b border-white/[0.06] px-3 pb-2 text-[10px]
        font-semibold tracking-wide text-zinc-600 uppercase`}
    >
      <span aria-hidden="true" className="size-5" />
      <span>Source</span>
      <span className="hidden sm:block" title="Average gap between posts, over the last 30 days">
        Typical
      </span>
      <span className="text-right sm:text-left">Last post</span>
      <span aria-hidden="true" className="size-7" />
    </div>
  )
}

export function FolderRowView({
  folder,
  open,
  onToggle,
  handle,
  menu,
  attentionCount,
  isDropTarget,
}: {
  folder: TreeFolder
  open: boolean
  onToggle: () => void
  handle: ReactNode
  menu: ReactNode
  attentionCount: number
  isDropTarget: boolean
}) {
  return (
    <div
      className={`${ROW_GRID} rounded-lg px-3 py-2 transition-colors ${
        isDropTarget ? "bg-blue-500/10 ring-1 ring-blue-400/30" : "hover:bg-white/[0.03]"
      }`}
    >
      {handle}

      <span className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={open ? `Collapse ${folder.name}` : `Expand ${folder.name}`}
          className="flex size-4 shrink-0 items-center justify-center text-zinc-500 hover:text-zinc-200"
        >
          <ChevronRight
            className={`size-3.5 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
          />
        </button>
        <Folder className="size-3.5 shrink-0 text-zinc-500" />
        {folder.isRealFolder ? (
          <Link
            to={folder.href}
            className="min-w-0 truncate text-sm font-semibold text-zinc-100 hover:underline"
          >
            {folder.name}
          </Link>
        ) : (
          // Not a link to itself: the bucket is a rendering device, not a place.
          <span className="min-w-0 truncate text-sm font-semibold text-zinc-400">
            {folder.name}
          </span>
        )}
        <span className="shrink-0 text-xs text-zinc-600">
          {/* The count is the first thing to yield when the name has no room. */}
          <span className="hidden sm:inline">
            {folder.feeds.length} {folder.feeds.length === 1 ? "feed" : "feeds"}
          </span>
          {attentionCount > 0 && (
            <span className="text-amber-400/80 sm:ml-1.5">
              <span className="hidden sm:inline">· </span>
              {attentionCount} {attentionCount === 1 ? "needs" : "need"} a look
            </span>
          )}
        </span>
      </span>

      <span className="hidden sm:block" />
      <span />
      {menu}
    </div>
  )
}

export function FeedRowView({
  feed,
  handle,
  menu,
  onRetry,
  retrying,
}: {
  feed: TreeFeed
  handle: ReactNode
  menu: ReactNode
  onRetry: () => void
  retrying: boolean
}) {
  const health = feed.health
  const status = health ? sourceStatus(health) : "new"
  const style = STATUS_STYLE[status]
  const gap = health ? formatGap(typicalGapMs(health)) : null

  return (
    <div
      className={`${ROW_GRID} rounded-lg py-1.5 pr-3 pl-9 text-xs transition-colors hover:bg-white/[0.03]`}
    >
      {handle}

      <span className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          title={style.label}
          className={`size-1.5 shrink-0 rounded-full ${style.dot}`}
        />
        <Link to={feed.href} className="min-w-0 truncate font-medium text-zinc-200 hover:underline">
          {feed.name}
        </Link>
        {/*
          Beside the name rather than replacing the status dot: how a source is
          read and whether it is currently working are different facts, and a
          watched page can be perfectly healthy.
        */}
        {feed.kind === "page" && <PageSourceDot />}
      </span>

      {/*
        "no data" rather than a dash or a zero. Under three posts in the window
        there is no interval to average, and a feed we have held for two days
        genuinely has nothing to report.
      */}
      <span className="hidden text-zinc-500 tabular-nums sm:block">{gap ?? "no data"}</span>

      <span className="flex items-center justify-end gap-1.5 text-zinc-500 tabular-nums sm:justify-start">
        {health?.lastPostAt ? timeAgo(health.lastPostAt) : "Never"}
        {status === "broken" && (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            title="Retry now"
            aria-label={`Retry ${feed.name}`}
            className="inline-flex size-5 items-center justify-center rounded text-amber-400/90
              transition-colors hover:bg-white/10 hover:text-amber-300 disabled:opacity-50"
          >
            <RefreshCw className={`size-3 ${retrying ? "animate-spin" : ""}`} />
          </button>
        )}
      </span>

      {menu}
    </div>
  )
}
