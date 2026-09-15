import { ChevronDown, Pencil, Settings2, Share2, Trash2 } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

/**
 * Manage / share / rename / delete for whatever the breadcrumb is pointing at.
 *
 * Extracted from the old `Breadcrumb` component, which rendered the crumb
 * chain *and* this menu and was mounted only inside the top bar's `md:hidden`
 * branch — so on a desktop screen none of these actions existed. Splitting the
 * menu from the chain is what lets `AppTopBar` render one chain at both widths
 * and hang this off the leaf.
 */
const ITEM =
  "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm text-foreground dark:text-zinc-300 " +
  "transition-colors hover:bg-accent dark:hover:bg-zinc-800 hover:text-foreground dark:hover:text-white focus:bg-accent dark:focus:bg-zinc-800 focus:text-foreground dark:focus:text-white"

export function CrumbMenu({
  label,
  folderId,
  feedId,
  onManage,
  onManageFeed,
  onShare,
  onRename,
  onDelete,
  onShareFeed,
  onRenameFeed,
  onDeleteFeed,
}: {
  /** The crumb's own text, passed back to the handlers that need a name. */
  label: string
  folderId?: string
  feedId?: string
  onManage?: (folderId: string) => void
  onManageFeed?: (feedId: string) => void
  onShare?: (folderId: string, folderName: string) => void
  onRename?: (folderId: string, folderName: string) => void
  onDelete?: (folderId: string, folderName: string) => void
  onShareFeed?: (feedId: string, feedName: string) => void
  onRenameFeed?: (feedId: string, feedName: string) => void
  onDeleteFeed?: (feedId: string, feedName: string) => void
}) {
  /*
    Gating on the ids alone was not enough: every item is also gated on its
    handler, so a caller passing `folderId` with no handlers — exactly what a
    read-only view does — drew a chevron that opened an empty panel.
  */
  const isFeed = !!feedId
  const hasItems = isFeed
    ? !!(onManageFeed || onShareFeed || onRenameFeed || onDeleteFeed)
    : !!folderId && !!(onManage || onShare || onRename || onDelete)

  if (!hasItems) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={isFeed ? "Feed actions" : "Folder actions"}
        className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground dark:text-zinc-500
          transition-colors hover:bg-accent dark:hover:bg-white/5 hover:text-foreground dark:hover:text-zinc-200"
      >
        <ChevronDown className="size-3.5" />
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        className="min-w-52 rounded-xl border border-border dark:border-zinc-800 bg-card dark:bg-zinc-900 p-1 shadow-2xl"
      >
        {!isFeed && folderId && (
          <>
            {onManage && (
              <DropdownMenuItem className={ITEM} onClick={() => onManage(folderId)}>
                <Settings2 className="size-4" />
                Manage folder
              </DropdownMenuItem>
            )}
            {onShare && (
              <DropdownMenuItem className={ITEM} onClick={() => onShare(folderId, label)}>
                <Share2 className="size-4" />
                Share this folder
              </DropdownMenuItem>
            )}
            {onRename && (
              <DropdownMenuItem className={ITEM} onClick={() => onRename(folderId, label)}>
                <Pencil className="size-4" />
                Rename
              </DropdownMenuItem>
            )}
            {(onShare || onRename) && onDelete && (
              <DropdownMenuSeparator className="my-1 bg-accent dark:bg-zinc-800" />
            )}
            {onDelete && (
              <DropdownMenuItem
                className={`${ITEM} text-red-700 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 focus:text-red-700 dark:focus:text-red-300`}
                onClick={() => onDelete(folderId, label)}
              >
                <Trash2 className="size-4" />
                Delete
              </DropdownMenuItem>
            )}
          </>
        )}

        {isFeed && feedId && (
          <>
            {onManageFeed && (
              <>
                <DropdownMenuItem className={ITEM} onClick={() => onManageFeed(feedId)}>
                  <Settings2 className="size-4" />
                  Manage feed
                </DropdownMenuItem>
                <DropdownMenuSeparator className="my-1 bg-accent dark:bg-zinc-800" />
              </>
            )}
            {onShareFeed && (
              <DropdownMenuItem className={ITEM} onClick={() => onShareFeed(feedId, label)}>
                <Share2 className="size-4" />
                Share this feed
              </DropdownMenuItem>
            )}
            {onRenameFeed && (
              <DropdownMenuItem className={ITEM} onClick={() => onRenameFeed(feedId, label)}>
                <Pencil className="size-4" />
                Rename
              </DropdownMenuItem>
            )}
            {(onShareFeed || onRenameFeed) && onDeleteFeed && (
              <DropdownMenuSeparator className="my-1 bg-accent dark:bg-zinc-800" />
            )}
            {onDeleteFeed && (
              <DropdownMenuItem
                className={`${ITEM} text-red-700 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 focus:text-red-700 dark:focus:text-red-300`}
                onClick={() => onDeleteFeed(feedId, label)}
              >
                <Trash2 className="size-4" />
                Delete
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
