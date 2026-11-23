import { useEffect, useId, useRef, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import {
  Check,
  ChevronDown,
  Folder,
  FolderPlus,
  Loader2,
  Plus,
} from "lucide-react"
import type { Destination } from "@/server/services/feed-write"
import { useWorkspaceNavigation } from "@/components/WorkspaceDataProvider"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { getImportStatus, importCatalogueItem } from "@/server/catalogue"
import { DEMO_MODE } from "@/lib/demo"

/** How long to keep asking before assuming a feed is simply slow. */
const POLL_MS = 2500
const POLL_TIMEOUT_MS = 90_000

/**
 * The one stateful component in the Discover tree.
 *
 * Three states, matching the pattern the app already uses for adding a shared
 * folder: Add → Adding… → Added. The import itself returns in well under a
 * second because it does no network work; the progress line underneath tracks
 * the articles arriving afterwards.
 */
export function AddCatalogueButton({
  kind,
  slug,
  label,
  alreadyAdded,
  onImported,
  className,
  tone = "primary",
}: {
  kind: "collection" | "feed"
  slug: string
  /** e.g. "Add all" / "Add 3 more" / "Add". */
  label: string
  alreadyAdded: boolean
  onImported: () => void
  /**
   * Applied to the wrapper, not the button — the progress line lives there too.
   * The exception is `chip`, which has no wrapper and takes this directly.
   */
  className?: string
  /**
   * `secondary` for an Add that sits beside a bigger one.
   *
   * Adding a single feed from inside a collection is a real choice but a rarer
   * one than taking the whole collection. Rendered identically, three solid
   * white per-feed buttons simply out-shouted the one "Add all" above them.
   *
   * `chip` goes further: no border, no fill, sized to match the link and RSS
   * tags it sits beside. A bordered button in a row of 18px tags is a foreign
   * object — it sets the row's height on its own and, on a phone, is the thing
   * that pushes the row onto a second line.
   */
  tone?: "primary" | "secondary" | "chip"
}) {
  const navigate = useNavigate()
  const folderInputId = useId()
  const navigation = useWorkspaceNavigation()
  const [createOpen, setCreateOpen] = useState(false)
  const [folderName, setFolderName] = useState("")
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState(false)
  const [progress, setProgress] = useState<{
    done: number
    total: number
  } | null>(null)
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([])

  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  /**
   * Polls until every feed reports a fetch or an error.
   *
   * Losing this — by navigating away, say — stops the progress line but not the
   * work: the ingest queue is detached from the request that started it.
   */
  const track = (feedIds: Array<string>) => {
    const startedAt = Date.now()
    const tick = async () => {
      try {
        const status = await getImportStatus({ data: { feedIds } })
        setProgress({ done: status.done, total: status.total })
        if (status.done >= status.total) {
          setProgress(null)
          onImported()
          return
        }
      } catch {
        // A failed poll is not worth surfacing; the import already succeeded.
      }
      if (Date.now() - startedAt < POLL_TIMEOUT_MS) {
        timers.current.push(setTimeout(tick, POLL_MS))
      } else {
        setProgress(null)
        onImported()
      }
    }
    timers.current.push(setTimeout(tick, POLL_MS))
  }

  const handleAdd = async (destination: Destination = { kind: "none" }) => {
    if (adding || alreadyAdded || added) return
    if (DEMO_MODE) {
      // Rendered live rather than disabled: a page of dead buttons is a worse
      // demo than one that explains itself.
      toast.warning("Feature locked in demo mode", {
        description: "Sign up to add sources to your own workspace.",
      })
      return
    }

    setAdding(true)
    try {
      const result = await importCatalogueItem({
        data: { kind, slug, destination },
      })

      if (result.status === "already_added") {
        setAdded(true)
        toast.info("Already in your workspace")
        return
      }
      if (result.status === "error") {
        toast.error(result.message)
        return
      }

      setAdded(true)
      setCreateOpen(false)
      setFolderName("")
      onImported()

      const skippedNote =
        result.skipped > 0 ? ` ${result.skipped} you already had.` : ""
      toast.success(`${label === "Add" ? "Feed" : "Collection"} added`, {
        description: `${result.added} ${result.added === 1 ? "feed" : "feeds"} added.${skippedNote} Articles are loading.`,
        ...(result.folderId
          ? {
              action: {
                label: "Open folder",
                onClick: () => void navigate({ to: "/" }),
              },
            }
          : {}),
      })

      track(result.feedIds)
    } catch (err) {
      console.error(err)
      toast.error("Could not add that")
    } finally {
      setAdding(false)
    }
  }

  // `alreadyAdded` is derived from the user's own feeds, so it survives a page
  // reload where the local flag would not. It has to win, or refreshing would
  // reset a card to "Add" and mislead.
  const isAdded = alreadyAdded || added

  if (tone === "chip") {
    /*
      Progress replaces the label rather than appearing beneath it. The stacked
      version is fine under a real button, which owns its own line anyway; here
      it would grow the row it is meant to fit inside.
    */
    const Icon = adding ? Loader2 : isAdded ? Check : Plus
    return (
      <button
        type="button"
        disabled={adding || isAdded}
        onClick={() => void handleAdd()}
        title={isAdded ? "Already in your workspace" : "Add this feed"}
        className={cn(
          /* Same box as the link and RSS tags beside it — see CHIP there. */
          "inline-flex shrink-0 items-center gap-1 rounded-md border border-border dark:border-white/10 bg-muted dark:bg-white/5",
          "px-1.5 py-0.5 text-[10px] font-semibold transition-colors disabled:cursor-default",
          isAdded
            ? "text-muted-foreground dark:text-zinc-500"
            : "text-foreground dark:text-zinc-300 hover:bg-accent dark:hover:bg-white/10 hover:text-foreground dark:hover:text-white",
          className
        )}
      >
        <Icon className={cn("size-2.5 shrink-0", adding && "animate-spin")} />
        {progress
          ? `${progress.done}/${progress.total}`
          : adding
            ? "Adding"
            : isAdded
              ? "Added"
              : label}
      </button>
    )
  }

  return (
    <div className={cn("flex flex-col items-end gap-1", className)}>
      <div className="inline-flex items-stretch [&>button:first-child]:rounded-r-none">
        <Button
          size="sm"
          variant={isAdded || tone === "secondary" ? "outline" : "default"}
          disabled={adding || isAdded}
          onClick={() => void handleAdd()}
          className={
            isAdded
              ? "h-8 border-border dark:border-zinc-700 text-xs text-muted-foreground dark:text-zinc-400"
              : tone === "secondary"
                ? /*
                  The `dark:` duplicates are load-bearing. The outline variant
                  ships `dark:border-input dark:bg-input/30`, and tailwind-merge
                  treats a `dark:`-prefixed utility as a different group from its
                  bare form — so `bg-transparent` alone loses to it, leaving a
                  filled button that still read as primary.
                */
                  "h-8 border-border dark:border-white/30 bg-transparent text-xs font-medium text-foreground dark:text-zinc-100 " +
                  "hover:border-border dark:hover:border-white/50 hover:bg-accent dark:hover:bg-white/10 hover:text-foreground dark:hover:text-white " +
                  "dark:border-white/30 dark:bg-transparent dark:hover:border-white/50 dark:hover:bg-white/10"
                : "h-8 bg-primary dark:bg-white text-xs font-semibold text-primary-foreground dark:text-black hover:bg-primary/90 dark:hover:bg-zinc-200"
          }
        >
          {adding ? (
            <>
              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              Adding…
            </>
          ) : isAdded ? (
            <>
              <Check className="mr-1.5 size-3.5" />
              Added
            </>
          ) : (
            <>
              <Plus className="mr-1.5 size-3.5" />
              {label}
            </>
          )}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                size="sm"
                variant={
                  isAdded || tone === "secondary" ? "outline" : "default"
                }
              />
            }
            disabled={adding || isAdded}
            aria-label="Add to folder"
            className={cn(
              "h-8 w-8 rounded-l-none border-l px-0",
              tone === "primary" && !isAdded
                ? "border-border dark:border-black/15 bg-primary dark:bg-white text-primary-foreground dark:text-black hover:bg-primary/90 dark:hover:bg-zinc-200"
                : "border-border dark:border-white/20"
            )}
          >
            <ChevronDown className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {navigation.isPending && (
              <DropdownMenuItem disabled>Loading folders…</DropdownMenuItem>
            )}
            {navigation.isError && (
              <DropdownMenuItem onClick={() => void navigation.refetch()}>
                Could not load folders. Retry
              </DropdownMenuItem>
            )}
            {navigation.data?.folders.map((folder) => (
              <DropdownMenuItem
                key={folder.id}
                onClick={() =>
                  void handleAdd({ kind: "existing", folderId: folder.id })
                }
              >
                <Folder className="size-4" />
                <span className="truncate">{folder.name}</span>
              </DropdownMenuItem>
            ))}
            {navigation.data?.folders.length === 0 && (
              <DropdownMenuItem disabled>No folders yet</DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={DEMO_MODE}
              onClick={() => setCreateOpen(true)}
            >
              <FolderPlus className="size-4" />
              Create folder…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!adding) {
            setCreateOpen(open)
            if (!open) setFolderName("")
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Create folder and add</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (folderName.trim())
                void handleAdd({ kind: "new", name: folderName.trim() })
            }}
          >
            <label htmlFor={folderInputId} className="mb-2 block text-sm">
              Folder name
            </label>
            <Input
              id={folderInputId}
              autoFocus
              maxLength={60}
              value={folderName}
              disabled={adding}
              onChange={(event) => setFolderName(event.target.value)}
            />
            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="ghost"
                disabled={adding}
                onClick={() => setCreateOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={adding || !folderName.trim()}>
                {adding ? "Adding…" : "Create and add"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {progress && (
        <span className="text-[10px] text-muted-foreground dark:text-zinc-500 tabular-nums">
          Fetching articles… {progress.done}/{progress.total}
        </span>
      )}
    </div>
  )
}
