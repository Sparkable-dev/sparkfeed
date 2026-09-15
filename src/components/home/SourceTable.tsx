import { useState } from "react"
import { Link } from "@tanstack/react-router"
import { Loader2, MoreHorizontal, RefreshCw, Rss, Trash2 } from "lucide-react"
import { toast } from "sonner"
import type { HomeSource } from "@/server/home"
import type { SourceStatus } from "@/lib/source-health"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { copyText } from "@/lib/clipboard"
import { DEMO_MODE } from "@/lib/demo"
import { formatGap, sourceStatus, typicalGapMs } from "@/lib/source-health"
import { timeAgo } from "@/lib/time-ago"
import { deleteFeed, refreshFeed } from "@/server/rss"

/**
 * Every source, its rhythm, and whether it still works.
 *
 * Nothing else in the product will tell you a feed has stopped fetching. It
 * keeps its row in the sidebar and simply produces nothing, which looks exactly
 * like a publisher having a slow week, and the truth only lives in a manage
 * dialog nobody opens. This table is where that becomes visible.
 *
 * Two columns that look similar and are not: "Typical" is the mean gap between
 * posts and "Last post" is when the publisher last shipped. The mean alone
 * lies — twenty posts in one burst then silence still reads as "every 4h" — so
 * the pair sits side by side, where the second immediately corrects the first.
 *
 * Sorted by what needs attention rather than alphabetically. A table you read
 * top-down should put the broken feed first, not the one starting with A.
 */

/** Beyond this the list scrolls rather than stretching the hero. */
const MAX_HEIGHT = "max-h-[280px]"

const STATUS_STYLE: Record<SourceStatus, { dot: string; label: string }> = {
  broken: { dot: "bg-amber-400", label: "Not fetching" },
  quiet: { dot: "bg-accent dark:bg-zinc-600", label: "Quiet" },
  new: { dot: "bg-blue-400/70", label: "New" },
  active: { dot: "bg-emerald-400/80", label: "Active" },
}

/** Attention first, then the busiest. See the note on sorting above. */
const STATUS_RANK: Record<SourceStatus, number> = {
  broken: 0,
  quiet: 1,
  new: 2,
  active: 3,
}

/*
  One grid, declared once and applied to the header and every row, so the
  columns cannot drift apart. The two middle columns drop below `sm`: in a
  column that is 7/12 of a bento on a desktop and the full width of a phone,
  something has to give, and a cadence is less use than a name.
*/
const GRID =
  "grid grid-cols-[1fr_auto_auto] items-center gap-x-3 sm:grid-cols-[1fr_4.5rem_5rem_1.75rem]"

export function SourceTable({
  sources,
  onChanged,
}: {
  sources: Array<HomeSource>
  /** Reloads the page after a retry or a removal. */
  onChanged: () => void
}) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<HomeSource | null>(null)

  if (sources.length === 0) return null

  const now = Date.now()
  const rows = sources
    .map((source) => ({
      source,
      status: sourceStatus(source, now),
      gap: formatGap(typicalGapMs(source)),
    }))
    .sort(
      (a, b) =>
        STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
        b.source.posts30d - a.source.posts30d,
    )

  const needsAttention = rows.filter(
    (r) => r.status === "broken" || r.status === "quiet",
  ).length

  const guardDemo = () => {
    if (DEMO_MODE) {
      toast.warning("Feature locked in demo mode")
      return true
    }
    return false
  }

  const handleRetry = async (source: HomeSource) => {
    if (guardDemo()) return
    setBusyId(source.id)
    try {
      const result = await refreshFeed({ data: { feedId: source.id } })
      if (result.ok) toast.success(`${source.name} is fetching again`)
      else toast.error(`${source.name} still could not be reached`)
      onChanged()
    } catch {
      toast.error("Could not retry that source")
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async () => {
    if (!pendingDelete) return
    const source = pendingDelete
    setPendingDelete(null)
    if (guardDemo()) return
    setBusyId(source.id)
    try {
      await deleteFeed({ data: { id: source.id } })
      toast.success(`${source.name} removed`)
      onChanged()
    } catch {
      toast.error("Could not remove that source")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <section className="min-w-0 rounded-2xl border border-border dark:border-white/[0.07] bg-card dark:bg-white/[0.02]">
        {/*
          The title doubles as the first column's header. It was two rows and a
          "Source" label directly under the word "Sources", which spent a whole
          row saying nothing — the column under a heading called Sources needs
          no second announcement.

          "last 30 days" moved onto the Typical header as a tooltip. It only
          ever qualified that one column, and as a caption floating at the far
          right it read as if it described the whole table.
        */}
        <div className={`${GRID} border-b border-border dark:border-white/[0.06] px-3.5 pt-3 pb-2`}>
          <h2 className="min-w-0 truncate text-sm font-bold tracking-tight text-foreground dark:text-zinc-100">
            Sources
            <span className="ml-2 text-xs font-medium text-muted-foreground dark:text-zinc-500">
              {needsAttention > 0
                ? `${needsAttention} ${needsAttention === 1 ? "needs" : "need"} a look`
                : `${sources.length} active`}
            </span>
          </h2>
          <span
            title="Average gap between posts, over the last 30 days"
            className={`hidden text-[10px] font-semibold tracking-wide text-muted-foreground dark:text-zinc-600 uppercase sm:block`}
          >
            Typical
          </span>
          <span className="text-right text-[10px] font-semibold tracking-wide text-muted-foreground dark:text-zinc-600 uppercase sm:text-left">
            Last post
          </span>
          <span aria-hidden="true" />
        </div>

        <div className={`${MAX_HEIGHT} min-w-0 overflow-y-auto`}>
          {rows.map(({ source, status, gap }) => {
            const style = STATUS_STYLE[status]
            const busy = busyId === source.id
            return (
              <div
                key={source.id}
                className={`${GRID} border-b border-border dark:border-white/[0.04] px-3.5 py-2 text-xs last:border-0
                  transition-colors hover:bg-accent dark:hover:bg-white/[0.03]`}
              >
                <Link to={source.href} className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden="true"
                    title={style.label}
                    className={`size-1.5 shrink-0 rounded-full ${style.dot}`}
                  />
                  <span className="min-w-0 truncate font-medium text-foreground dark:text-zinc-200">
                    {source.name}
                  </span>
                </Link>

                {/*
                  "no data" rather than a dash or a zero. Under three posts in
                  the window there is no interval to average, and a source we
                  have only held for two days genuinely has nothing to report.
                */}
                <span className="hidden text-muted-foreground dark:text-zinc-500 tabular-nums sm:block">
                  {gap ?? "no data"}
                </span>

                <span className="text-right text-muted-foreground dark:text-zinc-500 tabular-nums sm:text-left">
                  {source.lastPostAt ? timeAgo(source.lastPostAt) : "Never"}
                </span>

                <div className="flex justify-end">
                  {status === "broken" && !busy ? (
                    <button
                      type="button"
                      onClick={() => void handleRetry(source)}
                      title="Retry now"
                      className="inline-flex size-6 items-center justify-center rounded-md text-amber-700 dark:text-amber-400/90
                        transition-colors hover:bg-accent dark:hover:bg-white/10 hover:text-amber-700 dark:hover:text-amber-300"
                    >
                      <RefreshCw className="size-3" />
                    </button>
                  ) : busy ? (
                    <span className="inline-flex size-6 items-center justify-center text-muted-foreground dark:text-zinc-500">
                      <Loader2 className="size-3 animate-spin" />
                    </span>
                  ) : (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        aria-label={`Manage ${source.name}`}
                        className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground dark:text-zinc-600
                          transition-colors hover:bg-accent dark:hover:bg-white/10 hover:text-foreground dark:hover:text-zinc-200"
                      >
                        <MoreHorizontal className="size-3.5" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="min-w-[180px] rounded-xl border border-border dark:border-zinc-700/60 bg-card dark:bg-[#0a0a0a] p-1 text-foreground dark:text-zinc-200 shadow-2xl"
                      >
                        {/* No "Open" entry: the row's name is already the link. */}
                        <DropdownMenuItem
                          onClick={() =>
                            void copyText(source.url, {
                              successMessage: "Feed URL copied",
                            })
                          }
                          className="cursor-pointer gap-2 rounded-lg px-2.5 py-1.5 text-xs"
                        >
                          <Rss className="size-3.5 text-muted-foreground dark:text-zinc-500" />
                          Copy feed URL
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => void handleRetry(source)}
                          className="cursor-pointer gap-2 rounded-lg px-2.5 py-1.5 text-xs"
                        >
                          <RefreshCw className="size-3.5 text-muted-foreground dark:text-zinc-500" />
                          Fetch now
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="my-1 bg-accent dark:bg-zinc-800" />
                        <DropdownMenuItem
                          onClick={() => setPendingDelete(source)}
                          className="cursor-pointer gap-2 rounded-lg px-2.5 py-1.5 text-xs text-red-700 dark:text-red-400 focus:text-red-700 dark:focus:text-red-400"
                        >
                          <Trash2 className="size-3.5" />
                          Remove source
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/*
        Removing a source deletes its articles with it and there is no undo, so
        it asks. The count is in the question rather than in fine print: it is
        the part people do not expect.
      */}
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent className="border-border dark:border-zinc-800 bg-card dark:bg-zinc-950 text-foreground dark:text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {pendingDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground dark:text-zinc-400">
              This deletes the source and everything it has fetched. It cannot be
              undone, but you can add the feed again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border dark:border-zinc-700 bg-transparent text-foreground dark:text-zinc-300 hover:bg-accent dark:hover:bg-zinc-800">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
              className="bg-red-600 text-white hover:bg-red-500"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
