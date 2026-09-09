import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import { ExternalLink, Loader2, Pencil, Trash2, TriangleAlert } from "lucide-react"
import type { FeedRow, FolderRow } from "@/lib/rss-types"
import type {ManagedSource} from "@/server/rss";
import { timeAgo } from "@/lib/time-ago"

import {

  deleteFeed,
  deleteFolder,
  getFolderManageData
} from "@/server/rss"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { EditFeedModal } from "@/components/EditFeedModal"
import { FolderFeedsTable } from "@/components/folder/FolderFeedsTable"
import { ShareSettings } from "@/components/folder/ShareSettings"
import { DEMO_MODE } from "@/lib/demo"

export type ManageTarget =
  | { kind: "folder"; id: string; name: string; folderId?: null }
  /** `folderId` is the feed's parent, used to find its health row. */
  | { kind: "feed"; id: string; name: string; folderId?: string | null }

interface ManageModalProps {
  target: ManageTarget | null
  folders: Array<FolderRow>
  feeds: Array<FeedRow>
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after anything that changes what the sidebar should show. */
  onChanged?: () => void
}

function DetailRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-zinc-800/60 py-2.5 last:border-0">
      <span className="shrink-0 text-xs text-zinc-500">{label}</span>
      <span className="min-w-0 text-right text-xs text-zinc-200">{children}</span>
    </div>
  )
}

/**
 * Settings for one folder or one feed.
 *
 * Both get Sharing and a danger zone; only the first tab differs — a folder
 * manages the sources inside it, a feed has only itself to describe. One
 * component rather than two because the dialog, the tab chrome and the hoisted
 * confirmations are identical, and two copies of that would drift.
 */
export function ManageModal({
  target,
  folders,
  feeds,
  open,
  onOpenChange,
  onChanged,
}: ManageModalProps) {
  const navigate = useNavigate()

  const [sources, setSources] = useState<Array<ManagedSource>>([])
  const [loading, setLoading] = useState(false)
  const [editingFeed, setEditingFeed] = useState<FeedRow | null>(null)
  const [pendingRemoval, setPendingRemoval] = useState<ManagedSource | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [confirmName, setConfirmName] = useState("")
  const [deleting, setDeleting] = useState(false)

  const kind = target?.kind ?? "folder"
  const isFeed = kind === "feed"
  const name = target?.name ?? ""

  const guardDemo = () => {
    if (DEMO_MODE) {
      toast.warning("Feature locked in demo mode")
      return true
    }
    return false
  }

  // A feed's health lives in its parent folder's manage payload, so both kinds
  // load from the same place. A folderless feed simply has no health row.
  const scopeFolderId = target
    ? isFeed
      ? (target.folderId ?? null)
      : target.id
    : null

  const load = useCallback(async () => {
    if (!scopeFolderId) {
      setSources([])
      return
    }
    setLoading(true)
    try {
      const next = await getFolderManageData({ data: { folderId: scopeFolderId } })
      setSources(next.sources)
    } catch (err) {
      console.error(err)
      toast.error("Could not load this folder")
    } finally {
      setLoading(false)
    }
  }, [scopeFolderId])

  // The dialog is mounted permanently by its host, so the fetch hangs off
  // `open` rather than mount — otherwise every sidebar render would load every
  // folder's sources.
  useEffect(() => {
    if (!open) return
    setConfirmName("")
    void load()
  }, [open, load])

  const feedRow = isFeed ? feeds.find((f) => f.id === target?.id) : undefined
  const feedHealth = isFeed ? sources.find((s) => s.id === target?.id) : undefined

  const handleRemoveSource = async () => {
    if (!pendingRemoval || guardDemo()) return
    const source = pendingRemoval
    setPendingRemoval(null)
    try {
      // One delete for both kinds now. A watched page used to live in its own
      // table with its own id space, so removing one needed its own server
      // function — and until that existed, no watched source could be deleted
      // at all.
      await deleteFeed({ data: { id: source.id } })
      toast.success(`"${source.name}" removed`)
      await load()
      onChanged?.()
    } catch (err) {
      console.error(err)
      toast.error("Could not remove that source")
    }
  }

  const handleDelete = async () => {
    if (!target || guardDemo()) return
    setDeleting(true)
    try {
      if (isFeed) {
        await deleteFeed({ data: { id: target.id } })
      } else {
        await deleteFolder({ data: { id: target.id } })
      }
      toast.success(`"${name}" deleted`)
      setDeleteOpen(false)
      onOpenChange(false)
      onChanged?.()
      await navigate({ to: "/" })
    } catch (err) {
      console.error(err)
      toast.error(`Could not delete that ${kind}`)
    } finally {
      setDeleting(false)
    }
  }

  const rssCount = sources.filter((s) => s.type === "rss").length
  const scrapedCount = sources.length - rssCount
  const failing = sources.filter((s) => s.lastError).length

  const subtitle = isFeed
    ? (feedRow?.url ?? "Feed settings")
    : loading
      ? "Loading…"
      : sources.length === 0
        ? "No sources in this folder yet."
        : `${sources.length} source${sources.length === 1 ? "" : "s"} · ${rssCount} RSS · ${scrapedCount} scraped${failing ? ` · ${failing} failing` : ""}`

  // `flex-none` overrides the primitive's flex-1, which would otherwise spread
  // the labels across the full dialog width.
  const triggerClass =
    "h-full flex-none rounded-none border-b-2 border-transparent px-0 text-sm font-semibold text-zinc-500 transition-colors hover:text-zinc-200 data-active:border-white data-active:text-white"

  const firstTab = isFeed ? "details" : "sources"

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[85vh] w-[92vw] flex-col overflow-hidden border-zinc-800 bg-zinc-950 p-0 text-white sm:max-w-[880px]">
          <DialogHeader className="min-w-0 shrink-0 px-6 pt-6">
            <DialogTitle className="truncate text-xl font-bold tracking-tight">
              {name}
            </DialogTitle>
            <DialogDescription className="truncate text-zinc-500">
              {subtitle}
            </DialogDescription>
          </DialogHeader>

          <Tabs
            key={`${kind}-${target?.id ?? ""}`}
            defaultValue={firstTab}
            className="flex min-h-0 w-full flex-1 flex-col overflow-hidden"
          >
            <div className="shrink-0 px-6">
              <TabsList
                variant="line"
                className="h-10 w-full justify-start gap-6 rounded-none border-b border-zinc-800 bg-transparent p-0"
              >
                <TabsTrigger value={firstTab} className={triggerClass}>
                  {isFeed ? "Details" : "Sources"}
                </TabsTrigger>
                <TabsTrigger value="sharing" className={triggerClass}>
                  Sharing
                </TabsTrigger>
                <TabsTrigger value="danger" className={triggerClass}>
                  Danger zone
                </TabsTrigger>
              </TabsList>
            </div>

            {/* Fixed height so switching tabs does not resize the dialog. */}
            <div className="h-[440px] overflow-y-auto px-6 py-5">
              {isFeed ? (
                <TabsContent value="details" className="mt-0">
                  <div className="flex flex-col">
                    <DetailRow label="URL">
                      <a
                        href={feedRow?.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 break-all text-zinc-300 underline-offset-2 hover:underline"
                      >
                        {feedRow?.url}
                        <ExternalLink className="size-3 shrink-0" />
                      </a>
                    </DetailRow>
                    <DetailRow label="Type">
                      {feedHealth?.type === "scraped"
                        ? "Scraped — no feed on this site, so we read the page"
                        : "RSS — read directly from the site's feed"}
                    </DetailRow>
                    <DetailRow label="Articles">
                      {loading ? "…" : (feedHealth?.articleCount ?? 0)}
                    </DetailRow>
                    <DetailRow label="Last checked">
                      {loading ? "…" : timeAgo(feedHealth?.lastFetchedAt)}
                    </DetailRow>
                    <DetailRow label="Status">
                      {feedHealth?.lastError ? (
                        <span className="inline-flex items-start gap-1.5 text-red-400">
                          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                          {feedHealth.lastError}
                        </span>
                      ) : feedHealth?.lastFetchedAt ? (
                        <span className="text-emerald-400">OK</span>
                      ) : (
                        <span className="text-zinc-500">Not checked yet</span>
                      )}
                    </DetailRow>
                  </div>

                  <Button
                    variant="outline"
                    className="mt-5 border-zinc-700 text-zinc-300 hover:bg-white/5 hover:text-white"
                    onClick={() => {
                      if (guardDemo() || !feedRow) return
                      setEditingFeed(feedRow)
                    }}
                  >
                    <Pencil className="mr-2 size-4" />
                    Edit feed
                  </Button>
                </TabsContent>
              ) : (
                <TabsContent value="sources" className="mt-0">
                  {loading ? (
                    <div className="flex h-32 items-center justify-center">
                      <Loader2 className="size-5 animate-spin text-zinc-600" />
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      <p className="text-xs leading-relaxed text-zinc-500">
                        Sites with a feed are read directly. Sites without one
                        are read by parsing the page, which is why they can stop
                        finding posts if the site changes.
                      </p>
                      <FolderFeedsTable
                        sources={sources}
                        onEdit={(source) => {
                          if (guardDemo()) return
                          const feed = feeds.find((f) => f.id === source.id)
                          if (feed) setEditingFeed(feed)
                        }}
                        onDelete={setPendingRemoval}
                      />
                    </div>
                  )}
                </TabsContent>
              )}

              <TabsContent value="sharing" className="mt-0">
                <p className="mb-4 text-xs leading-relaxed text-zinc-500">
                  {isFeed
                    ? "A share link is public to anyone who has it, and shows this feed's articles."
                    : "A share link is public to anyone who has it, and everything inside this folder is visible through it."}
                </p>
                {/* Keyed so reopening the dialog refetches the current state
                    rather than showing whatever it last saw. */}
                {open && target && (
                  <ShareSettings
                    key={`${kind}-${target.id}`}
                    entityId={target.id}
                    entityName={name}
                    type={kind}
                    onStateChange={onChanged ? () => onChanged() : undefined}
                  />
                )}
              </TabsContent>

              <TabsContent value="danger" className="mt-0">
                <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
                  <h3 className="text-sm font-semibold text-zinc-100">
                    Delete this {kind}
                  </h3>
                  <p className="mt-1 mb-4 text-xs leading-relaxed text-zinc-400">
                    {isFeed
                      ? "Removes this feed and every article cached from it. This cannot be undone."
                      : "Removes its feeds, every cached article, the scraped sources beneath it, and any sub-folders. This cannot be undone."}
                  </p>
                  <Button
                    variant="outline"
                    className="border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                    onClick={() => {
                      setConfirmName("")
                      setDeleteOpen(true)
                    }}
                  >
                    <Trash2 className="mr-2 size-4" />
                    Delete this {kind}
                  </Button>
                </div>
              </TabsContent>
            </div>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/*
        These three live outside <Dialog>, not inside it. Nesting a dialog in a
        dialog is what WorkspaceSettingsModal ran into (see the note at its
        confirmation dialogs); as siblings they compose fine.
      */}
      <EditFeedModal
        open={editingFeed !== null}
        onOpenChange={(next) => { if (!next) setEditingFeed(null) }}
        folders={folders}
        onFeedUpdated={() => { void load(); onChanged?.() }}
        editingFeed={editingFeed}
      />

      <AlertDialog
        open={pendingRemoval !== null}
        onOpenChange={(next) => { if (!next) setPendingRemoval(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this source?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{pendingRemoval?.name}</strong> and its{" "}
              {pendingRemoval?.articleCount ?? 0} cached articles will be
              deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 text-zinc-400 hover:bg-white/5 hover:text-white">
              Keep it
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 font-semibold text-white hover:bg-red-700"
              onClick={(e) => { e.preventDefault(); void handleRemoveSource() }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Type-to-confirm, matching the workspace delete. A single red click
          used to destroy every feed and article inside a folder. */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              {isFeed
                ? "This permanently deletes the feed and every article cached from it."
                : `This permanently deletes ${sources.length} source${sources.length === 1 ? "" : "s"} and every article cached from them.`}{" "}
              Type <strong>{name}</strong> to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            placeholder={name}
            className="border-zinc-700 bg-zinc-950 text-white"
            autoFocus
          />
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 text-zinc-400 hover:bg-white/5 hover:text-white">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting || confirmName !== name}
              className="bg-red-600 font-semibold text-white hover:bg-red-700"
              onClick={(e) => { e.preventDefault(); void handleDelete() }}
            >
              {deleting ? "Deleting…" : `Delete ${kind}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
