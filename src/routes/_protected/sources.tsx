import { useCallback, useMemo, useState } from "react"
import { createFileRoute, useRouter } from "@tanstack/react-router"
import { toast } from "sonner"
import { ChevronsDownUp, ChevronsUpDown, FolderPlus, Plus } from "lucide-react"
import type { HeaderAction } from "@/components/layout/header-actions"
import type { FeedRow, FolderRow } from "@/lib/rss-types"
import type { TreeFolder } from "@/components/sources/source-tree"
import type {ManageTarget} from "@/components/folder/ManageModal";
import { invalidateWorkspace, loadWorkspaceData  } from "@/lib/workspace-query"
import { RSSShell } from "@/components/RSSShell"
import { SourcesPage } from "@/components/sources/SourcesPage"
import { buildTree } from "@/components/sources/source-tree"
import { SourcesDnd } from "@/components/sources/SourcesDnd"
import { useSourceOrder } from "@/components/sources/useSourceOrder"
import { AddFolderModal } from "@/components/AddFolderModal"
import { useAddFeed } from "@/components/add-feed/add-feed-context"
import { EditFeedModal } from "@/components/EditFeedModal"
import { FolderShareModal } from "@/components/FolderShareModal"
import { ManageModal  } from "@/components/folder/ManageModal"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { DEMO_MODE } from "@/lib/demo"
import {
  deleteFeed,
  deleteFolder,
  refreshFolder,
  renameFeed,
  renameFolder,
  updateFeed,
} from "@/server/rss"
import { getSourceHealth } from "@/server/sources-data"

/**
 * `/sources` — the whole workspace, arrangeable.
 *
 * The route owns every dialog and every mutation; `SourcesPage` renders and
 * reports intent. That split exists because the dialogs are shared with the
 * sidebar and the breadcrumb, so they have to be mounted by something that is
 * not the tree itself.
 */
export const Route = createFileRoute("/_protected/sources")({
  loader: async ({ context }) => {
    // getAllData is for the shell's sidebar, which every route renders, and it
    // already carries the folders and feeds in the order this page wants.
    const [data, health] = await Promise.all([loadWorkspaceData(context), getSourceHealth()])
    return { data, health }
  },
  component: SourcesRoute,
})

type RenameTarget = { kind: "folder" | "feed"; id: string; name: string }
type DeleteTarget = { kind: "folder" | "feed"; id: string; name: string }

function SourcesRoute() {
  const { data, health } = Route.useLoaderData()
  const router = useRouter()

  const folders = data.folders as Array<FolderRow>
  const feeds = data.feeds as Array<FeedRow>

  const loadedTree = useMemo(
    () => buildTree(folders, feeds, health),
    [folders, feeds, health],
  )

  /*
    The tree the page actually renders is local while the user is dragging, so
    a drop lands instantly rather than after a round trip. `useSourceOrder`
    owns reverting, queueing and reseeding.
  */
  const { tree, apply } = useSourceOrder({
    loaded: loadedTree,
    onSaved: () => void invalidateWorkspace(router),
  })

  /*
    Everything starts open. This page exists to show what you have, and opening
    to a list of closed folders would hide it. The sidebar starts mostly closed
    for the opposite reason — it is navigation, not inventory.
  */
  const [openFolders, setOpenFolders] = useState<Set<string>>(
    () => new Set(loadedTree.map((f) => f.id)),
  )

  /*
    Owned up here because the search box is in the top bar, which the shell
    renders from a description this component supplies. The page below reads it
    to filter; nothing else needs it.
  */
  const [filter, setFilter] = useState("")

  const [addFolderOpen, setAddFolderOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [shareTarget, setShareTarget] = useState<
    { type: "folder" | "feed"; id: string; name: string } | null
  >(null)
  const [manageTarget, setManageTarget] = useState<ManageTarget | null>(null)
  const [editingFeed, setEditingFeed] = useState<FeedRow | null>(null)

  const reload = useCallback(() => void invalidateWorkspace(router), [router])
  const { openAddFeed } = useAddFeed()

  const guardDemo = () => {
    if (DEMO_MODE) {
      toast.warning("Feature locked in demo mode")
      return true
    }
    return false
  }

  const toggleFolder = (id: string) =>
    setOpenFolders((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  /*
    One dialog, mounted for the whole app. This used to be a locally mounted
    copy that had to be remounted with a `key` to change its default folder,
    because the folder was only read on mount.
  */
  const handleAddFeed = (folderId: string | null) => {
    if (guardDemo()) return
    openAddFeed({ folderId })
  }

  /*
    Everything this page can do to the collection as a whole, in the bar every
    other page keeps its controls in. They were a row of buttons under a
    duplicate heading before, which put "Add feed" in two different places
    depending on which page you happened to be on.

    "Collapse all" is one control, not two: with everything shut the only
    useful thing it can do is open everything again, and a second button that
    is dead half the time is worse than a label that changes.
  */
  const allCollapsed = openFolders.size === 0
  const headerActions: Array<HeaderAction> = [
    {
      kind: "search",
      id: "source-search",
      value: filter,
      onChange: setFilter,
      placeholder: "Search sources…",
    },
    {
      kind: "button",
      id: "collapse-all-btn",
      icon: allCollapsed ? ChevronsUpDown : ChevronsDownUp,
      label: allCollapsed ? "Expand all folders" : "Collapse all folders",
      onClick: () =>
        setOpenFolders(allCollapsed ? new Set(tree.map((f) => f.id)) : new Set()),
      variant: "ghost",
    },
    {
      kind: "button",
      id: "new-folder-btn",
      icon: FolderPlus,
      label: "New folder",
      onClick: () => {
        if (guardDemo()) return
        setAddFolderOpen(true)
      },
      variant: "ghost",
    },
    {
      kind: "button",
      id: "add-feed-btn",
      icon: Plus,
      label: "Add Feed",
      onClick: () => handleAddFeed(null),
      variant: "primary",
    },
  ]

  const handleRenameConfirm = async () => {
    if (!renameTarget || !renameValue.trim() || renameValue === renameTarget.name) {
      setRenameTarget(null)
      return
    }
    try {
      const payload = { data: { id: renameTarget.id, name: renameValue.trim() } }
      if (renameTarget.kind === "folder") await renameFolder(payload)
      else await renameFeed(payload)
      setRenameTarget(null)
      reload()
    } catch {
      toast.error(`Could not rename that ${renameTarget.kind}`)
    }
  }

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return
    const target = deleteTarget
    setDeleteTarget(null)
    if (guardDemo()) return
    try {
      if (target.kind === "folder") await deleteFolder({ data: { id: target.id } })
      else await deleteFeed({ data: { id: target.id } })
      toast.success(`${target.name} deleted`)
      reload()
    } catch {
      toast.error(`Could not delete that ${target.kind}`)
    }
  }

  /**
   * The menu's path to the same move dragging performs.
   *
   * Goes through `updateFeed` rather than `saveSourceOrder` because it is a
   * single move with no reordering: the feed lands at the end of its new
   * folder, which is where an unpositioned row sorts anyway.
   */
  const handleMoveToFolder = async (feedId: string, folderId: string | null) => {
    if (guardDemo()) return
    const feed = feeds.find((f) => f.id === feedId)
    if (!feed) return
    try {
      const parse = (raw: string | null | undefined): Array<string> => {
        if (!raw) return []
        try {
          return JSON.parse(raw) as Array<string>
        } catch {
          return []
        }
      }
      const result = await updateFeed({
        data: {
          id: feed.id,
          name: feed.name,
          url: feed.url,
          folderId,
          includeKeywords: parse(feed.includeKeywords),
          excludeKeywords: parse(feed.excludeKeywords),
        },
      })
      if (result.status === "error") {
        toast.error(result.error.message)
        return
      }
      toast.success(
        folderId
          ? `Moved to ${folders.find((f) => f.id === folderId)?.name ?? "folder"}`
          : "Moved out of its folder",
      )
      reload()
    } catch {
      toast.error("Could not move that feed")
    }
  }

  const handleRefreshFolder = async (folder: TreeFolder) => {
    try {
      await refreshFolder({ data: { folderId: folder.id } })
      toast.success(`${folder.name} refreshed`)
      reload()
    } catch {
      toast.error("Could not refresh that folder")
    }
  }

  return (
    <RSSShell
      initialData={{
        folders: data.folders,
        feeds: data.feeds,
        articles: data.articles,
      }}
      title="Sources"
      actions={headerActions}
    >
      <SourcesDnd tree={tree} onApply={apply}>
        {({ dropTargetId }) => (
      <SourcesPage
        tree={tree}
        dndEnabled
        dropTargetId={dropTargetId}
        openFolders={openFolders}
        onToggleFolder={toggleFolder}
        filter={filter}
        onAddFeed={handleAddFeed}
        onRenameFolder={(folder) => {
          if (guardDemo()) return
          setRenameTarget({ kind: "folder", id: folder.id, name: folder.name })
          setRenameValue(folder.name)
        }}
        onShareFolder={(folder) => {
          if (guardDemo()) return
          setShareTarget({ type: "folder", id: folder.id, name: folder.name })
        }}
        onManageFolder={(folder) =>
          setManageTarget({ kind: "folder", id: folder.id, name: folder.name })
        }
        onDeleteFolder={(folder) =>
          setDeleteTarget({ kind: "folder", id: folder.id, name: folder.name })
        }
        onRefreshFolder={(folder) => void handleRefreshFolder(folder)}
        onRenameFeed={(id, name) => {
          if (guardDemo()) return
          setRenameTarget({ kind: "feed", id, name })
          setRenameValue(name)
        }}
        onShareFeed={(id, name) => {
          if (guardDemo()) return
          setShareTarget({ type: "feed", id, name })
        }}
        onEditFeed={(id) => {
          if (guardDemo()) return
          const feed = feeds.find((f) => f.id === id)
          if (feed) setEditingFeed(feed)
        }}
        onDeleteFeed={(id, name) => setDeleteTarget({ kind: "feed", id, name })}
        onMoveFeedToFolder={(id, folderId) => void handleMoveToFolder(id, folderId)}
        onChanged={reload}
      />
        )}
      </SourcesDnd>

      <AddFolderModal
        open={addFolderOpen}
        onOpenChange={setAddFolderOpen}
        onFolderCreated={reload}
      />

      <EditFeedModal
        open={editingFeed !== null}
        onOpenChange={(open: boolean) => {
          if (!open) setEditingFeed(null)
        }}
        editingFeed={editingFeed}
        folders={folders}
        onFeedUpdated={reload}
      />

      {shareTarget && (
        <FolderShareModal
          isOpen
          onClose={() => setShareTarget(null)}
          type={shareTarget.type}
          folderId={shareTarget.id}
          folderName={shareTarget.name}
        />
      )}

      <ManageModal
        target={manageTarget}
        folders={folders}
        feeds={feeds}
        open={manageTarget !== null}
        onOpenChange={(open: boolean) => {
          if (!open) setManageTarget(null)
        }}
        onChanged={reload}
      />

      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open: boolean) => {
          if (!open) setRenameTarget(null)
        }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Rename {renameTarget?.kind}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleRenameConfirm()
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button onClick={() => void handleRenameConfirm()}>Rename</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open: boolean) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent className="border-border dark:border-zinc-800 bg-card dark:bg-zinc-950 text-foreground dark:text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle>
            {/*
              Says what actually happens. Deleting a feed takes its articles
              with it, and deleting a folder takes every feed inside it and
              their articles too — neither is obvious from the word "delete".
            */}
            <AlertDialogDescription className="text-muted-foreground dark:text-zinc-400">
              {deleteTarget?.kind === "folder"
                ? "This deletes the folder, every feed inside it, and all of their articles. It cannot be undone."
                : "This deletes the feed and every article it has fetched. It cannot be undone, but you can add the feed again later."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border dark:border-zinc-700 bg-transparent text-foreground dark:text-zinc-300 hover:bg-accent dark:hover:bg-zinc-800">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDeleteConfirm()}
              className="bg-red-600 text-white hover:bg-red-500"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </RSSShell>
  )
}
