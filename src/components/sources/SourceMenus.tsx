import {
  ExternalLink,
  FolderInput,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Rss,
  Settings2,
  Share2,
  SlidersHorizontal,
  Trash2,
} from "lucide-react"
import type { TreeFeed, TreeFolder } from "./source-tree"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { copyText } from "@/lib/clipboard"
import { UNFILED_DESTINATION } from "@/lib/unfiled"

/**
 * The per-row action menus.
 *
 * Almost every item here opens something that already exists — the manage
 * dialog, the share panel, the edit-feed form — rather than reimplementing it.
 * The page is the new place to reach them from, not a second implementation of
 * what they do.
 */

const TRIGGER =
  "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-zinc-600 " +
  "transition-colors hover:bg-white/10 hover:text-zinc-200"

const CONTENT =
  "min-w-[196px] rounded-xl border border-zinc-700/60 bg-[#0a0a0a] p-1 text-zinc-200 shadow-2xl"

const ITEM = "cursor-pointer gap-2 rounded-lg px-2.5 py-1.5 text-xs"
const DESTRUCTIVE = `${ITEM} text-red-400 focus:text-red-400`

/** Where a folder's own RSS export lives. See `routes/$folderSlug.xml.ts`. */
function folderFeedUrl(href: string): string {
  return typeof window === "undefined" ? "" : `${window.location.origin}${href}.xml`
}

export function FolderMenu({
  folder,
  onAddFeed,
  onRename,
  onShare,
  onManage,
  onRefresh,
  onDelete,
}: {
  folder: TreeFolder
  onAddFeed: () => void
  onRename: () => void
  onShare: () => void
  onManage: () => void
  onRefresh: () => void
  onDelete: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={`Manage ${folder.name}`} className={TRIGGER}>
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={CONTENT}>
        <DropdownMenuItem onClick={onAddFeed} className={ITEM}>
          <Rss className="size-3.5 text-zinc-500" />
          Add feed to this folder
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onRefresh} className={ITEM}>
          <RefreshCw className="size-3.5 text-zinc-500" />
          Refresh all feeds
        </DropdownMenuItem>
        <DropdownMenuSeparator className="my-1 bg-zinc-800" />
        <DropdownMenuItem onClick={onRename} className={ITEM}>
          <Pencil className="size-3.5 text-zinc-500" />
          Rename…
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onShare} className={ITEM}>
          <Share2 className="size-3.5 text-zinc-500" />
          Share…
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() =>
            void copyText(folderFeedUrl(folder.href), {
              successMessage: "Folder feed URL copied",
            })
          }
          className={ITEM}
        >
          <ExternalLink className="size-3.5 text-zinc-500" />
          Copy folder feed URL
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onManage} className={ITEM}>
          <Settings2 className="size-3.5 text-zinc-500" />
          Manage…
        </DropdownMenuItem>
        <DropdownMenuSeparator className="my-1 bg-zinc-800" />
        <DropdownMenuItem onClick={onDelete} className={DESTRUCTIVE}>
          <Trash2 className="size-3.5" />
          Delete folder…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function FeedMenu({
  feed,
  folders,
  currentFolderId,
  onRename,
  onShare,
  onEdit,
  onMoveTo,
  onDelete,
  onFetchNow,
}: {
  feed: TreeFeed
  folders: Array<{ id: string; name: string }>
  currentFolderId: string | null
  onRename: () => void
  onShare: () => void
  onEdit: () => void
  onMoveTo: (folderId: string | null) => void
  onDelete: () => void
  onFetchNow: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={`Manage ${feed.name}`} className={TRIGGER}>
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={CONTENT}>
        <DropdownMenuItem onClick={onFetchNow} className={ITEM}>
          <RefreshCw className="size-3.5 text-zinc-500" />
          Fetch now
        </DropdownMenuItem>

        {/*
          The move that does not need a mouse. Dragging is the headline
          interaction on this page, but it is unusable on a phone and awkward
          with a keyboard, so the same move lives here as a plain menu.
        */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className={ITEM}>
            <FolderInput className="size-3.5 text-zinc-500" />
            Move to folder
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className={CONTENT}>
            {folders.map((folder) => (
              <DropdownMenuItem
                key={folder.id}
                disabled={folder.id === currentFolderId}
                onClick={() => onMoveTo(folder.id)}
                className={ITEM}
              >
                {folder.name}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator className="my-1 bg-zinc-800" />
            <DropdownMenuItem
              disabled={currentFolderId === null}
              onClick={() => onMoveTo(null)}
              className={ITEM}
            >
              {UNFILED_DESTINATION}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator className="my-1 bg-zinc-800" />
        <DropdownMenuItem onClick={onRename} className={ITEM}>
          <Pencil className="size-3.5 text-zinc-500" />
          Rename…
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onEdit} className={ITEM}>
          <SlidersHorizontal className="size-3.5 text-zinc-500" />
          Edit filters…
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onShare} className={ITEM}>
          <Share2 className="size-3.5 text-zinc-500" />
          Share…
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => void copyText(feed.url, { successMessage: "Feed URL copied" })}
          className={ITEM}
        >
          <Rss className="size-3.5 text-zinc-500" />
          Copy feed URL
        </DropdownMenuItem>

        <DropdownMenuSeparator className="my-1 bg-zinc-800" />
        <DropdownMenuItem onClick={onDelete} className={DESTRUCTIVE}>
          <Trash2 className="size-3.5" />
          Remove feed…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
