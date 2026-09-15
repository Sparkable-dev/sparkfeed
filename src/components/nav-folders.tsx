"use client"

import { useEffect, useState } from "react"
import { Link, useNavigate, useRouterState } from "@tanstack/react-router"
import { ChevronRight, Edit2, FolderIcon, Globe, Link2, Lock, PlusIcon, Rss, Settings2, Share2, Trash2 } from "lucide-react"
import { toast } from "sonner"
import type { FeedRow, FolderRow } from "@/lib/rss-types"
import type { ReactNode } from "react"
import type {ManageTarget} from "@/components/folder/ManageModal";
import { slugify } from "@/lib/slugify"
import { UNFILED_LABEL } from "@/lib/unfiled"
import { copyText } from "@/lib/clipboard"
import { buildShareUrl } from "@/lib/share-url"

import { AddFolderModal } from "@/components/AddFolderModal"
import { PageSourceDot } from "@/components/PageSourceDot"
import { FolderShareModal } from "@/components/FolderShareModal"
import { ManageModal  } from "@/components/folder/ManageModal"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { deleteFeed, deleteFolder, renameFolder } from "@/server/rss"
import { DEMO_MODE } from "@/lib/demo"
import { useSidebar } from "@/components/ui/sidebar"
import { useGuestShare } from "@/hooks/guest-share-context"
import { useCommandAction } from "@/components/command/command-palette-context"

const guardDemo = () => {
  if (DEMO_MODE) { toast.warning("Feature locked in demo mode"); return true }
  return false
}

/**
 * Visibility indicator for a folder or feed row.
 *
 * Private is the default and gets no icon — marking the ordinary case is noise.
 * The previous rule showed a padlock when `isShared === false` *or* the item
 * had a password, so a password-protected public folder read as private, and
 * there was no way at all to tell a public one at a glance.
 */
function ShareBadge({
  isShared,
  hasPassword,
}: {
  isShared?: boolean
  hasPassword?: boolean
}) {
  if (!isShared) return null
  return hasPassword ? (
    <Lock
      className="size-3 shrink-0 text-muted-foreground opacity-70"
      aria-label="Shared, password protected"
    />
  ) : (
    <Globe
      className="size-3 shrink-0 text-muted-foreground opacity-70"
      aria-label="Shared publicly"
    />
  )
}

interface NavFoldersProps {
  folders: Array<FolderRow>
  feeds: Array<FeedRow>
  articleCounts: Record<string, number>
  /** Distinct articles per folder; sibling feeds from one site overlap, so this is not the sum of articleCounts. */
  folderArticleCounts: Record<string, number>
  onFolderCreated: () => void
  onEditFeed: (feed: FeedRow) => void
}

function FolderLabel({ folder, count }: { folder: FolderRow; count: number }) {
  return <>
    <FolderIcon className="size-4 shrink-0 text-sidebar-foreground/60" />
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      <span className="truncate" title={folder.name}>{folder.name}</span>
      <ShareBadge isShared={folder.isShared} hasPassword={folder.hasPassword} />
    </span>
    {count > 0 && <span className="rounded-md bg-sidebar-accent px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">{count}</span>}
  </>
}

function RowMenu({ menu, children }: { menu: ReactNode; children: ReactNode }) {
  const guest = useGuestShare()
  return guest ? <>{children}</> : (
    <ContextMenu>
      <ContextMenuTrigger>{children}</ContextMenuTrigger>
      {menu}
    </ContextMenu>
  )
}

export function NavFolders({
  folders,
  feeds,
  articleCounts,
  folderArticleCounts,
  onFolderCreated,
  onEditFeed,
}: NavFoldersProps) {
  const [addFolderOpen, setAddFolderOpen] = useState(false)
  const [deleteData, setDeleteData] = useState<{ type: "folder" | "feed"; id: string; name: string } | null>(null)
  const [shareModalTarget, setShareModalTarget] = useState<{ type: "folder" | "feed"; id: string; name: string; isPublic: boolean } | null>(null)
  const [manageTarget, setManageTarget] = useState<ManageTarget | null>(null)
  const [renameFolderData, setRenameFolderData] = useState<{ id: string, name: string } | null>(null)
  const [newFolderName, setNewFolderName] = useState("")
  const routerState = useRouterState()
  const pathname = routerState.location.pathname
  const navigate = useNavigate()
  const { isMobile, setOpenMobile } = useSidebar()
  const closeMobile = () => { if (isMobile) setOpenMobile(false) }

  const guest = useGuestShare()

  // "New folder" lives here because the dialog does. Guests cannot create one,
  // and their route has no palette to publish it to anyway.
  useCommandAction(
    "new-folder",
    guest ? null : () => { if (!guardDemo()) setAddFolderOpen(true) },
  )

  const [openFolders, setOpenFolders] = useState<Set<string>>(() => {
    const initial = new Set<string>()

    // A guest's path is /sprk/..., which matches none of the rules below, so
    // the shared folder would open collapsed and its feeds would be invisible
    // — on a page whose entire purpose is that folder.
    if (guest) {
      initial.add(guest.entityId)
      return initial
    }

    for (const folder of folders) {
      const folderSlug = slugify(folder.name)
      const folderFeeds = feeds.filter((f) => f.folderId === folder.id)
      const isUnder =
        pathname === `/${folderSlug}` ||
        folderFeeds.some((f) => pathname === `/${folderSlug}/${slugify(f.name)}`)
      if (isUnder) initial.add(folder.id)
    }
    return initial
  })

  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(sessionStorage.getItem("sparkfeed-sidebar-open-folders") ?? "[]")
      if (Array.isArray(saved)) {
        setOpenFolders((previous) => new Set([...saved.filter((id): id is string => typeof id === "string"), ...previous]))
      }
    } catch { /* Folder expansion still works when storage is unavailable. */ }
  }, [])

  const activeFolderId = folders.find((folder) => {
    const folderSlug = slugify(folder.name)
    return guest
      ? folder.id === guest.entityId || feeds.some((feed) => feed.folderId === folder.id && feed.id === guest.selectedFeedId)
      : pathname === `/${folderSlug}` || feeds.some((feed) => feed.folderId === folder.id && pathname === `/${folderSlug}/${slugify(feed.name)}`)
  })?.id

  useEffect(() => {
    if (activeFolderId) setOpenFolders((previous) => new Set(previous).add(activeFolderId))
  }, [pathname, activeFolderId, guest?.selectedFeedId])

  const setFolderOpen = (folderId: string, open: boolean) => {
    const next = new Set(openFolders)
    if (open) next.add(folderId)
    else next.delete(folderId)
    setOpenFolders(next)
    try { sessionStorage.setItem("sparkfeed-sidebar-open-folders", JSON.stringify([...next])) } catch { /* Optional preference. */ }
  }

  const handleRenameConfirm = async () => {
    if (!renameFolderData || !newFolderName || newFolderName === renameFolderData.name) {
      setRenameFolderData(null)
      return
    }
    try {
      await renameFolder({ data: { id: renameFolderData.id, name: newFolderName } })
      setRenameFolderData(null)
      onFolderCreated()
    } catch (error) {
      toast.error("Failed to rename folder")
    }
  }

  const handleDeleteConfirm = async () => {
    if (!deleteData) return
    try {
      if (deleteData.type === "folder") {
        await deleteFolder({ data: { id: deleteData.id } })
        setDeleteData(null)
        navigate({ to: "/" })
        onFolderCreated()
        toast.success("Folder deleted")
      } else {
        await deleteFeed({ data: { id: deleteData.id } })
        setDeleteData(null)
        onFolderCreated()
        toast.success("Feed deleted")
      }
    } catch (err) {
      console.error(err)
      toast.error(`Failed to delete ${deleteData.type}`)
      setDeleteData(null)
    }
  }

  const standAloneFeeds = feeds.filter((f) => !f.folderId)

  /**
   * Copies the public link without opening the share dialog.
   *
   * The link only resolves while the entity is actually shared, so an unshared
   * one says so rather than handing over a URL that shows a sign-in wall.
   */
  const handleCopyShareLink = (item: {
    id: string
    name: string
    isShared?: boolean
  }) => {
    if (!item.isShared) {
      toast.warning(`"${item.name}" is private`, {
        description: "Turn on the share link first.",
      })
      return
    }
    copyText(buildShareUrl(item.name, item.id), {
      successMessage: "Share link copied",
    })
  }

  return (
    <>
      {/* ── Folders section ──────────────────────────────────── */}
      <div className="flex shrink-0 flex-col px-3 pt-3 group-data-[collapsible=icon]:hidden">

        {/* Section heading — same px-2 left edge as the rows below */}
        <div className="flex items-center justify-between px-2 mb-1">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground select-none">
            Folders
          </span>
          {!guest && (
            <button
              onClick={() => { if (!guardDemo()) setAddFolderOpen(true) }}
              aria-label="Add folder"
              className="flex size-7 items-center justify-center rounded-md text-sidebar-foreground/40 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors duration-150"
            >
              <PlusIcon className="size-3.5" />
            </button>
          )}
        </div>

        {/* Folder rows */}
        <div className="flex flex-col gap-0.5">
          {folders.map((folder) => {
            const folderSlug = slugify(folder.name)
            const folderFeeds = feeds.filter((f) => f.folderId === folder.id)
            const folderCount =
              folderArticleCounts[folder.id] ??
              folderFeeds.reduce((acc, f) => acc + (articleCounts[f.id] || 0), 0)
            // A guest's URL is /sprk/<slug>-<uuid>, which never matches
            // /<folderSlug>, so pathname-based highlighting would leave the
            // whole tree looking dead. Selection lives in the guest context
            // instead.
            const isRootShared = !!guest && folder.id === guest.entityId
            const isFolderActive = guest
              ? isRootShared && guest.selectedFeedId === null
              : pathname === `/${folderSlug}`
            const isAnyFeedActive = guest
              ? folderFeeds.some((f) => f.id === guest.selectedFeedId)
              : folderFeeds.some(
                  (f) => pathname === `/${folderSlug}/${slugify(f.name)}`
                )
            const isOpen = openFolders.has(folder.id)

            return (
              <Collapsible
                key={folder.id}
                open={isOpen}
                onOpenChange={(open) => setFolderOpen(folder.id, open)}
              >
                <RowMenu
                  menu={
                    <ContextMenuContent>
                      <ContextMenuItem onClick={() => {
                        if (guardDemo()) return
                        setRenameFolderData({ id: folder.id, name: folder.name })
                        setNewFolderName(folder.name)
                      }}>
                        <Edit2 className="mr-2 size-4" /> Rename
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => {
                        setManageTarget({ kind: "folder", id: folder.id, name: folder.name })
                      }}>
                        <Settings2 className="mr-2 size-4" /> Manage folder
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem onClick={() => {
                        if (guardDemo()) return
                        setShareModalTarget({
                          type: "folder",
                          id: folder.id,
                          name: folder.name,
                          isPublic: folder.isShared === true,
                        })
                      }}>
                        <Share2 className="mr-2 size-4" /> Share
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => handleCopyShareLink(folder)}>
                        <Link2 className="mr-2 size-4" /> Copy share link
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        onClick={() => { if (!guardDemo()) setDeleteData({ type: "folder", id: folder.id, name: folder.name }) }}
                        className="text-red-600 focus:text-red-600"
                      >
                        <Trash2 className="mr-2 size-4" /> Delete
                      </ContextMenuItem>
                    </ContextMenuContent>
                  }
                >
                  <div className="flex items-center gap-1">
                    {guest ? (
                      <button type="button" aria-current={isFolderActive ? "page" : undefined}
                        className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm font-medium outline-none transition-colors hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-ring ${isFolderActive ? "bg-sidebar-accent text-sidebar-accent-foreground" : isAnyFeedActive ? "text-sidebar-foreground" : "text-sidebar-foreground/75"}`}
                        onClick={() => {
                          if (isRootShared) guest.selectFeed(null)
                          else void navigate({ to: "/sprk/$folderSlug", params: { folderSlug: `${folderSlug}-${folder.id}` } })
                          closeMobile()
                        }}>
                        <FolderLabel folder={folder} count={folderCount} />
                      </button>
                    ) : (
                      <Link to="/$folderSlug" params={{ folderSlug }} aria-current={isFolderActive ? "page" : undefined}
                        onClick={closeMobile}
                        className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm font-medium outline-none transition-colors hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-ring ${isFolderActive ? "bg-sidebar-accent text-sidebar-accent-foreground" : isAnyFeedActive ? "text-sidebar-foreground" : "text-sidebar-foreground/75"}`}>
                        <FolderLabel folder={folder} count={folderCount} />
                      </Link>
                    )}
                    {folderFeeds.length > 0 && (
                      <CollapsibleTrigger render={<button type="button" aria-label={`${isOpen ? "Collapse" : "Expand"} ${folder.name}`} title={`${isOpen ? "Collapse" : "Expand"} ${folder.name}`} className="grid size-8 shrink-0 place-items-center rounded-md text-sidebar-foreground/60 hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring" />}>
                        <ChevronRight className={`size-3.5 transition-transform duration-150 motion-reduce:transition-none ${isOpen ? "rotate-90" : ""}`} />
                      </CollapsibleTrigger>
                    )}
                  </div>
                </RowMenu>

                {/* Sub-feeds — indented by the icon width + gap */}
                <CollapsibleContent>
                  <div className="ml-4 mt-0.5 flex flex-col gap-0.5 border-l border-sidebar-border pl-3 pb-1">
                    {folderFeeds.map((feed) => {
                      const feedSlug = slugify(feed.name)
                      const feedCount = articleCounts[feed.id] || 0
                      const isFeedActive = guest
                        ? guest.selectedFeedId === feed.id
                        : pathname === `/${folderSlug}/${feedSlug}`

                      const rowClass = `group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors duration-150
                        ${isFeedActive
                          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                          : "text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground/90"
                        }`

                      const rowInner = (
                        <>
                          <span className="flex-1 truncate leading-none">{feed.name}</span>
                          {feed.kind === "page" && <PageSourceDot />}
                          <ShareBadge isShared={feed.isShared} hasPassword={feed.hasPassword} />
                          {feedCount > 0 && (
                            <span className="ml-auto rounded-md bg-sidebar-accent px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                              {feedCount}
                            </span>
                          )}
                        </>
                      )

                      return (
                        <RowMenu
                          key={feed.id}
                          menu={
                            <ContextMenuContent>
                              <ContextMenuItem onClick={() => {
                                if (guardDemo()) return
                                setManageTarget({ kind: "feed", id: feed.id, name: feed.name, folderId: feed.folderId })
                              }}>
                                <Settings2 className="mr-2 size-4" /> Manage feed
                              </ContextMenuItem>
                              <ContextMenuItem onClick={() => { if (!guardDemo()) onEditFeed(feed) }}>
                                <Edit2 className="mr-2 size-4" /> Edit feed
                              </ContextMenuItem>
                              <ContextMenuSeparator />
                              <ContextMenuItem onClick={() => {
                                if (guardDemo()) return
                                setShareModalTarget({
                                  type: "feed",
                                  id: feed.id,
                                  name: feed.name,
                                  isPublic: feed.isShared === true,
                                })
                              }}>
                                <Share2 className="mr-2 size-4" /> Share
                              </ContextMenuItem>
                              <ContextMenuItem onClick={() => handleCopyShareLink(feed)}>
                                <Link2 className="mr-2 size-4" /> Copy share link
                              </ContextMenuItem>
                              <ContextMenuSeparator />
                              <ContextMenuItem
                                onClick={() => { if (!guardDemo()) setDeleteData({ type: "feed", id: feed.id, name: feed.name }) }}
                                className="text-red-600 focus:text-red-600"
                              >
                                <Trash2 className="mr-2 size-4" /> Delete
                              </ContextMenuItem>
                            </ContextMenuContent>
                          }
                        >
                          {/*
                            A guest filters in place instead of navigating —
                            /$folderSlug/$feedSlug is under _protected and would
                            bounce them to the login page.
                          */}
                          {guest ? (
                            <button
                              type="button"
                              data-active={isFeedActive}
                              className={rowClass}
                              aria-current={isFeedActive ? "page" : undefined}
                              onClick={() => { guest.selectFeed(feed.id); closeMobile() }}
                            >
                              {rowInner}
                            </button>
                          ) : (
                            <Link
                              to="/$folderSlug/$feedSlug"
                              params={{ folderSlug, feedSlug }}
                              data-active={isFeedActive}
                              aria-current={isFeedActive ? "page" : undefined}
                              onClick={closeMobile}
                              className={rowClass}
                            >
                              {rowInner}
                            </Link>
                          )}
                        </RowMenu>
                      )
                    })}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )
          })}
        </div>
      </div>

      {/* ── Standalone feeds (no folder) ─────────────────────── */}
      {standAloneFeeds.length > 0 && (
        <div className="flex shrink-0 flex-col px-3 pt-3 group-data-[collapsible=icon]:hidden">
          <div className="flex items-center px-2 mb-1">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground select-none">
              {UNFILED_LABEL}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            {standAloneFeeds.map((feed) => {
              const feedSlug = slugify(feed.name)
              const feedCount = articleCounts[feed.id] || 0
              const isFeedActive = guest
                ? guest.selectedFeedId === feed.id
                : pathname === `/feed/${feedSlug}`

              return (
                <RowMenu
                  key={feed.id}
                  menu={
                    <ContextMenuContent>
                      <ContextMenuItem onClick={() => {
                        if (guardDemo()) return
                        setManageTarget({ kind: "feed", id: feed.id, name: feed.name, folderId: feed.folderId })
                      }}>
                        <Settings2 className="mr-2 size-4" /> Manage feed
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => { if (!guardDemo()) onEditFeed(feed) }}>
                        <Edit2 className="mr-2 size-4" /> Edit feed
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem onClick={() => {
                        if (guardDemo()) return
                        setShareModalTarget({
                          type: "feed",
                          id: feed.id,
                          name: feed.name,
                          isPublic: feed.isShared === true,
                        })
                      }}>
                        <Share2 className="mr-2 size-4" /> Share
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => handleCopyShareLink(feed)}>
                        <Link2 className="mr-2 size-4" /> Copy share link
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        onClick={() => { if (!guardDemo()) setDeleteData({ type: "feed", id: feed.id, name: feed.name }) }}
                        className="text-red-600 focus:text-red-600"
                      >
                        <Trash2 className="mr-2 size-4" /> Delete
                      </ContextMenuItem>
                    </ContextMenuContent>
                  }
                >
                  <button type="button"
                    data-active={isFeedActive}
                    className={`group flex w-full items-center gap-2.5 rounded-lg px-2 py-2 cursor-pointer transition-colors duration-150
                      ${isFeedActive
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "hover:bg-sidebar-accent/60 text-sidebar-foreground/70"
                      }`}
                    aria-current={isFeedActive ? "page" : undefined}
                    title={feed.name}
                    onClick={() => {
                      if (guest) guest.selectFeed(feed.id)
                      else void navigate({ to: "/feed/$feedSlug", params: { feedSlug } })
                      closeMobile()
                    }}
                  >
                    <span className="flex size-4 shrink-0 items-center justify-center">
                      <Rss className="size-4" />
                    </span>
                    <span className="flex-1 truncate text-left text-sm font-medium leading-none">{feed.name}</span>
                    {feed.kind === "page" && <PageSourceDot />}
                    <ShareBadge isShared={feed.isShared} hasPassword={feed.hasPassword} />
                    {feedCount > 0 && (
                      <span className="ml-auto rounded-md bg-sidebar-accent px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                        {feedCount}
                      </span>
                    )}
                  </button>
                </RowMenu>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Modals ───────────────────────────────────────────── */}
      {/* None of these have a trigger a guest can reach; don't mount them. */}
      {guest ? null : (
      <>
      <AddFolderModal
        open={addFolderOpen}
        onOpenChange={setAddFolderOpen}
        onFolderCreated={() => onFolderCreated()}
      />

      <AlertDialog open={!!deleteData} onOpenChange={(open) => !open && setDeleteData(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the {deleteData?.type} <strong>{deleteData?.name}</strong>.
              {deleteData?.type === "folder" && " All feeds and articles inside this folder will also be deleted."}
              {deleteData?.type === "feed" && " All articles inside this feed will also be deleted."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground">
              Keep {deleteData?.type}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white font-semibold"
              onClick={(e) => {
                e.preventDefault()
                handleDeleteConfirm()
              }}
            >
              Yes, delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={renameFolderData !== null}
        onOpenChange={() => setRenameFolderData(null)}
      >
        <DialogContent className="bg-muted border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              Rename Folder
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Enter a new name for "{renameFolderData?.name}"
            </DialogDescription>
          </DialogHeader>
          <Input
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            className="bg-popover border-border text-foreground"
            placeholder="Folder name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRenameConfirm()
            }}
          />
          <DialogFooter>
            <Button
              variant="outline"
              className="border-border text-foreground"
              onClick={() => setRenameFolderData(null)}
            >
              Cancel
            </Button>
            <Button
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={handleRenameConfirm}
            >
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FolderShareModal
        folderId={shareModalTarget?.id ?? ""}
        folderName={shareModalTarget?.name ?? ""}
        isPublic={shareModalTarget?.isPublic ?? false}
        type={shareModalTarget?.type ?? "folder"}
        isOpen={shareModalTarget !== null}
        onClose={() => setShareModalTarget(null)}
      />

      <ManageModal
        target={manageTarget}
        folders={folders}
        feeds={feeds}
        open={manageTarget !== null}
        onOpenChange={(next) => { if (!next) setManageTarget(null) }}
        onChanged={onFolderCreated}
      />
      </>
      )}
    </>
  )
}
