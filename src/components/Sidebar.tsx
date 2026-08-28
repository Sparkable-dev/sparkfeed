import { useState } from "react"
import { Link, useRouterState } from "@tanstack/react-router"
import { Calendar, ChevronDown, ChevronRight, Heart, Lock, Newspaper, PanelLeftClose, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
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
import { deleteFeed, deleteFolder } from "@/server/rss"
import { slugify } from "@/lib/slugify"

export interface FeedRow {
  id: string
  name: string
  url: string
  folderId: string | null
  includeKeywords?: string | null
  excludeKeywords?: string | null
  /** From `feed_shares`. Undefined on any path that does not join that table. */
  isShared?: boolean
  hasPassword?: boolean
  /** Last successful fetch. Null for a feed that has never been read. */
  lastFetchedAt?: string | null
  /**
   * `rss`, or `page` for a site with no feed that we read from its listing.
   * Optional because several paths build a FeedRow without touching the column.
   */
  kind?: string | null
}

export interface FolderRow {
  id: string
  name: string
  isShared?: boolean
  hasPassword?: boolean
}

export type Selection =
  | { type: "all" }
  | { type: "today" }
  | { type: "bookmarks" }
  | { type: "read-later" }
  | { type: "favorites" }
  | { type: "folder"; folderId: string }
  | { type: "feed"; feedId: string; folderId: string }

interface SidebarProps {
  folders: Array<FolderRow>
  feeds: Array<FeedRow>
  articleCounts: Record<string, number>
  totalCount: number
  todayCount: number
  favoritesCount: number
  onAddFolderClick: () => void
  onAddFeedClick: () => void
  onEditFeedClick: (feed: FeedRow) => void
  onRefreshData: () => Promise<void>
  setSidebarOpen: (v: boolean) => void
}

export function Sidebar({
  folders,
  feeds,
  articleCounts,
  totalCount,
  todayCount,
  favoritesCount,
  onAddFolderClick,
  onAddFeedClick,
  onEditFeedClick,
  onRefreshData,
  setSidebarOpen,
}: SidebarProps) {
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({})
  const [deleteDialogItem, setDeleteDialogItem] = useState<{ type: "folder" | "feed", id: string, name: string } | null>(null)
  const routerState = useRouterState()
  const pathname = routerState.location.pathname

  const toggleFolder = (folderId: string) => {
    setExpandedFolders((prev) => ({ ...prev, [folderId]: !prev[folderId] }))
  }

  const getFeedCount = (feedId: string) => articleCounts[feedId] ?? 0

  const handleConfirmDelete = async () => {
    if (!deleteDialogItem) return
    try {
      if (deleteDialogItem.type === "folder") {
        await deleteFolder({ data: { id: deleteDialogItem.id } })
      } else {
        await deleteFeed({ data: { id: deleteDialogItem.id } })
      }
      await onRefreshData()
    } catch (e) {
      console.error("Delete failed", e)
    } finally {
      setDeleteDialogItem(null)
    }
  }

  return (
    <aside className="no-scrollbar flex h-screen w-40 shrink-0 flex-col overflow-y-auto bg-[#111111] py-3">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between px-3">
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(false)}
            className="h-6 w-6 text-zinc-400 hover:bg-white/10 hover:text-white"
          >
            <PanelLeftClose className="h-3.5 w-3.5" />
          </Button>
          <span className="text-sm font-semibold tracking-tight text-white">RSS</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          id="sidebar-add-btn"
          onClick={onAddFeedClick}
          className="h-6 w-6 text-zinc-400 hover:bg-white/10 hover:text-white"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* GENERAL */}
      <div className="mb-1">
        <p className="mb-1 px-3 text-[10px] font-semibold tracking-widest text-zinc-500 uppercase">
          General
        </p>

        <SidebarNavLink
          id="sidebar-explore"
          label="Explore"
          count={totalCount}
          href="/"
          active={pathname === "/"}
          badgeBlue
          icon={<Newspaper className={`h-4 w-4 ${pathname === "/" ? "text-white" : "text-zinc-400 group-hover:text-white"}`} />}
        />
        <SidebarNavLink
          id="sidebar-today"
          label="Today"
          count={todayCount}
          href="/today"
          active={pathname === "/today"}
          icon={<Calendar className={`h-4 w-4 ${pathname === "/today" ? "text-white" : "text-zinc-400 group-hover:text-white"}`} />}
        />
        <SidebarNavLink
          id="sidebar-favorites"
          label="Favorites"
          count={favoritesCount}
          href="/favorites"
          active={pathname === "/favorites"}
          icon={<Heart className={`h-4 w-4 ${pathname === "/favorites" ? "text-white" : "text-zinc-400 group-hover:text-white"}`} />}
        />
      </div>

      <div className="mx-3 my-2 h-px bg-white/5" />

      {/* FOLDERS */}
      <div className="mb-1">
        <p className="mb-1 px-3 text-[10px] font-semibold tracking-widest text-zinc-500 uppercase">
          Folders
        </p>

        {folders.map((folder) => {
          const folderSlug = slugify(folder.name)
          const folderFeeds = feeds.filter((f) => f.folderId === folder.id)
          const count = folderFeeds.reduce((sum, f) => sum + (articleCounts[f.id] ?? 0), 0)
          const expanded = expandedFolders[folder.id] ?? false
          const isFolderActive = pathname === `/${folderSlug}`
          return (
            <div key={folder.id}>
              <FolderContextMenu onRename={() => { }} onDelete={() => setTimeout(() => setDeleteDialogItem({ type: "folder", id: folder.id, name: folder.name }), 0)}>
                <FolderRow
                  id={`folder-${folder.id}`}
                  label={folder.name}
                  count={count}
                  expanded={expanded}
                  active={isFolderActive}
                  onArrowClick={() => toggleFolder(folder.id)}
                  folderSlug={folderSlug}
                  isShared={folder.isShared}
                  hasPassword={folder.hasPassword}
                />
              </FolderContextMenu>
              {expanded &&
                folderFeeds.map((feed) => {
                  const feedSlug = slugify(feed.name)
                  const feedPath = `/${folderSlug}/${feedSlug}`
                  return (
                    <FeedContextMenu key={feed.id} onEdit={() => onEditFeedClick(feed)} onDelete={() => setTimeout(() => setDeleteDialogItem({ type: "feed", id: feed.id, name: feed.name }), 0)}>
                      <FeedItem
                        id={`feed-${feed.id}`}
                        label={feed.name}
                        count={getFeedCount(feed.id)}
                        active={pathname === feedPath}
                        href={feedPath}
                      />
                    </FeedContextMenu>
                  )
                })}
            </div>
          )
        })}
      </div>

      <div className="mx-3 my-2 h-px bg-white/5" />

      {/* FEEDS (standalone — no folder) */}
      <div className="mb-2">
        <p className="mb-1 px-3 text-[10px] font-semibold tracking-widest text-zinc-500 uppercase">
          Feeds
        </p>

        {feeds
          .filter((f) => !f.folderId)
          .map((feed) => {
            const feedPath = `/folder/standalone/${feed.id}`
            return (
              <FeedContextMenu key={feed.id} onEdit={() => onEditFeedClick(feed)} onDelete={() => setTimeout(() => setDeleteDialogItem({ type: "feed", id: feed.id, name: feed.name }), 0)}>
                <SidebarNavLink
                  id={`standalone-${feed.id}`}
                  label={feed.name}
                  count={getFeedCount(feed.id)}
                  active={pathname === feedPath}
                  href={feedPath}
                />
              </FeedContextMenu>
            )
          })}
      </div>

      <div className="flex-1" />

      {/* New Folder */}
      <div className="px-3 pb-3">
        <button
          id="sidebar-new-folder-btn"
          onClick={onAddFolderClick}
          className="w-full rounded-md border border-dashed border-white/20 py-1.5 text-center text-[11px] text-zinc-500 transition-colors hover:border-white/40 hover:text-zinc-300"
        >
          + New Folder
        </button>
      </div>

      <AlertDialog open={!!deleteDialogItem} onOpenChange={(v) => !v && setDeleteDialogItem(null)}>
        <AlertDialogContent className="border-white/10 bg-[#181818] text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400">
              Are you sure you want to delete <span className="text-white font-medium">{deleteDialogItem?.name}</span>?
              This will also delete all articles from this feed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 text-black hover:bg-white/10 hover:text-white">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-red-500 text-white hover:bg-red-600">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  )
}

function FolderContextMenu({ children, onRename, onDelete }: { children: React.ReactNode, onRename: () => void, onDelete: () => void }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <div className="w-full cursor-context-menu">{children}</div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-40 border-white/10 bg-[#1a1a1a] text-zinc-300 shadow-2xl">
        <ContextMenuItem onSelect={onRename} onClick={onRename} className="cursor-pointer focus:bg-white/10 focus:text-white">Rename</ContextMenuItem>
        <ContextMenuItem onSelect={onDelete} onClick={onDelete} className="cursor-pointer text-red-400 focus:bg-red-500/20 focus:text-red-400">Delete</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function FeedContextMenu({ children, onEdit, onDelete }: { children: React.ReactNode, onEdit: () => void, onDelete: () => void }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <div className="w-full cursor-context-menu">{children}</div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-40 border-white/10 bg-[#1a1a1a] text-zinc-300 shadow-2xl">
        <ContextMenuItem onSelect={onEdit} onClick={onEdit} className="cursor-pointer focus:bg-white/10 focus:text-white">Edit feed</ContextMenuItem>
        <ContextMenuItem onSelect={onDelete} onClick={onDelete} className="cursor-pointer text-red-400 focus:bg-red-500/20 focus:text-red-400">Delete</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

// ─── Sub-components ────────────────────────────────

function SidebarNavLink({
  id,
  label,
  count,
  active,
  href,
  badgeBlue,
  icon,
}: {
  id: string
  label: string
  count: number
  active: boolean
  href: string
  badgeBlue?: boolean
  icon?: React.ReactNode
}) {
  return (
    <Link
      to={href}
      id={id}
      className={`group flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left text-xs transition-colors ${active
        ? "bg-white/10 text-white"
        : "text-zinc-400 hover:bg-white/5 hover:text-white"
        }`}
    >
      <div className="flex items-center gap-2">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      {badgeBlue ? (
        <Badge className="h-4 min-w-[1.25rem] bg-blue-500 px-1 text-[10px] font-semibold text-white">
          {count}
        </Badge>
      ) : (
        <span className="text-[10px] text-zinc-500">{count}</span>
      )}
    </Link>
  )
}

function FolderRow({
  id,
  label,
  count,
  expanded,
  active,
  onArrowClick,
  folderSlug,
  isShared,
  hasPassword,
}: {
  id: string
  label: string
  count: number
  expanded: boolean
  active: boolean
  onArrowClick: () => void
  folderSlug: string
  isShared?: boolean
  hasPassword?: boolean
}) {
  return (
    <div
      id={id}
      className={`flex w-full items-center justify-between rounded-md px-3 py-1.5 text-xs transition-colors ${active ? "bg-white/10 text-white" : "text-zinc-300 hover:bg-white/5 hover:text-white"
        }`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <button
          onClick={onArrowClick}
          className="shrink-0 text-zinc-500 hover:text-zinc-300"
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
        </button>
        <Link
          to="/$folderSlug"
          params={{ folderSlug }}
          className="min-w-0 flex-1 truncate text-left flex items-center gap-1.5"
        >
          <span className="truncate">{label}</span>
          {(isShared === false || hasPassword) && <Lock className="size-3 text-muted-foreground opacity-60 shrink-0" />}
        </Link>
      </div>
      <span className="ml-1 shrink-0 text-[10px] text-zinc-500">{count}</span>
    </div>
  )
}

function FeedItem({
  id,
  label,
  count,
  active,
  href,
}: {
  id: string
  label: string
  count: number
  active: boolean
  href: string
}) {
  return (
    <Link
      to={href}
      id={id}
      className={`flex w-full items-center justify-between rounded-r-md py-1.5 pl-6 pr-2 text-left text-[11px] transition-colors ${active ? "text-white" : "text-zinc-500 hover:text-zinc-300"
        }`}
    >
      <span className="truncate">{label}</span>
      <span className="ml-1 shrink-0 text-[10px] text-zinc-600">{count}</span>
    </Link>
  )
}
