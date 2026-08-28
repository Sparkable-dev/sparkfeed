import { useMemo, useState } from "react"
import { Link } from "@tanstack/react-router"
import { toast } from "sonner"
import { FeedRowView, FolderRowView, SourcesColumnHeader } from "./SourceRows"
import { FeedSortableContext } from "./SourcesDnd"
import { FolderDropZone, SortableFeed, SortableFolder } from "./SortableRows"
import { FeedMenu, FolderMenu } from "./SourceMenus"
import { SourcesOverview } from "./SourcesOverview"
import { buildOverview } from "./source-stats"
import type { ReactNode } from "react"
import type { TreeFolder } from "./source-tree"
import { DEMO_MODE } from "@/lib/demo"
import { sourceStatus } from "@/lib/source-health"
import { refreshFeed } from "@/server/rss"

/**
 * Every folder and every feed in the workspace, in one arrangeable tree, under
 * a strip that says how the collection as a whole is doing.
 *
 * Management rather than reading, which is why it looks like the source table
 * on Home rather than like an article page. The actions in the row menus are
 * almost entirely existing components — `ManageModal`, `ShareSettings`,
 * `EditFeedModal` — reached from here instead of from the sidebar's right-click
 * menus, so rename, share and delete stay written once.
 *
 * The page carries no heading and no toolbar of its own. It used to open with
 * an `<h1>Sources</h1>` directly under a top bar already reading "Sources", and
 * with its own row of buttons where every other page keeps them in that bar.
 * Both now live in the shell — see the `actions` prop on `RSSShell`.
 */

export interface SourcesPageProps {
  tree: Array<TreeFolder>
  openFolders: Set<string>
  onToggleFolder: (id: string) => void
  onAddFeed: (folderId: string | null) => void
  /**
   * The search box lives in the top bar, so its state belongs to the route that
   * builds that bar rather than to this component.
   */
  filter: string
  onRenameFolder: (folder: TreeFolder) => void
  onShareFolder: (folder: TreeFolder) => void
  onManageFolder: (folder: TreeFolder) => void
  onDeleteFolder: (folder: TreeFolder) => void
  onRefreshFolder: (folder: TreeFolder) => void
  onRenameFeed: (feedId: string, name: string) => void
  onShareFeed: (feedId: string, name: string) => void
  onEditFeed: (feedId: string) => void
  onDeleteFeed: (feedId: string, name: string) => void
  onMoveFeedToFolder: (feedId: string, folderId: string | null) => void
  onChanged: () => void
  /** False in demo mode, where nothing can be saved anyway. */
  dndEnabled: boolean
  /** Folder currently being hovered during a drag. */
  dropTargetId?: string | null
}

export function SourcesPage(props: SourcesPageProps) {
  const [retryingId, setRetryingId] = useState<string | null>(null)

  const query = props.filter.trim().toLowerCase()

  /*
    Filtering and dragging are mutually exclusive. The positions on screen while
    a filter is applied are not the positions that would be written, so a drag
    there would mean something different from what it looks like. Handles
    disappear and the page says why, rather than reordering something invisible.
  */
  const filtering = query.length > 0
  /** Dragging is only meaningful over the full, unfiltered list. */
  const draggable = !filtering && props.dndEnabled

  const visible = useMemo(() => {
    if (!filtering) return props.tree
    return props.tree
      .map((folder) => {
        const folderMatches = folder.name.toLowerCase().includes(query)
        const feeds = folder.feeds.filter(
          (feed) =>
            feed.name.toLowerCase().includes(query) || feed.url.toLowerCase().includes(query),
        )
        return folderMatches ? folder : { ...folder, feeds }
      })
      .filter((folder) => folder.feeds.length > 0 || folder.name.toLowerCase().includes(query))
  }, [props.tree, query, filtering])

  const folderChoices = props.tree
    .filter((f) => f.isRealFolder)
    .map((f) => ({ id: f.id, name: f.name }))

  const handleRetry = async (feedId: string, name: string) => {
    if (DEMO_MODE) {
      toast.warning("Feature locked in demo mode")
      return
    }
    setRetryingId(feedId)
    try {
      const result = await refreshFeed({ data: { feedId } })
      if (result.ok) toast.success(`${name} is fetching again`)
      else toast.error(`${name} still could not be reached`)
      props.onChanged()
    } catch {
      toast.error("Could not retry that source")
    } finally {
      setRetryingId(null)
    }
  }

  const totalFeeds = props.tree.reduce((n, f) => n + f.feeds.length, 0)

  /*
    Over the whole tree, never over `visible`. A search narrows what you are
    arranging; it does not change how many sources you own or how many of them
    have stopped, and an overview that moved with the filter would be reporting
    on the search rather than on the workspace.
  */
  const overview = useMemo(() => buildOverview(props.tree), [props.tree])

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-4 px-6 pt-5 pb-16">
      {totalFeeds > 0 && <SourcesOverview overview={overview} />}

      {filtering && (
        <p className="text-[11px] text-zinc-500">
          Showing matches only. Clear the search to rearrange — positions in a filtered list
          are not the positions that get saved.
        </p>
      )}

      <section className="min-w-0 rounded-2xl border border-white/[0.07] bg-white/[0.02] pt-3 pb-2">
        {/*
          The one thing the old heading said that nothing else does. The counts
          it carried are now the overview's job, and the word "Sources" was
          already in the top bar; that this list is the sidebar's order, and
          that dragging is how you change it, is not written anywhere else.
        */}
        {!filtering && totalFeeds > 0 && (
          <p className="px-3 pb-2 text-[11px] text-zinc-600">
            Drag to arrange — this is the order your sidebar uses.
          </p>
        )}

        <SourcesColumnHeader />

        <div className="flex flex-col px-1 pt-1">
          {visible.map((folder) => {
            const open = props.openFolders.has(folder.id) || filtering
            const attention = folder.feeds.filter((feed) => {
              if (!feed.health) return false
              const status = sourceStatus(feed.health)
              return status === "broken" || status === "quiet"
            }).length

            const feedRows = folder.feeds.map((feed) => {
              const row = (handle: ReactNode) => (
                <FeedRowView
                  feed={feed}
                  retrying={retryingId === feed.id}
                  onRetry={() => void handleRetry(feed.id, feed.name)}
                  handle={handle}
                  menu={
                    <FeedMenu
                      feed={feed}
                      folders={folderChoices}
                      currentFolderId={folder.isRealFolder ? folder.id : null}
                      onRename={() => props.onRenameFeed(feed.id, feed.name)}
                      onShare={() => props.onShareFeed(feed.id, feed.name)}
                      onEdit={() => props.onEditFeed(feed.id)}
                      onMoveTo={(folderId) => props.onMoveFeedToFolder(feed.id, folderId)}
                      onDelete={() => props.onDeleteFeed(feed.id, feed.name)}
                      onFetchNow={() => void handleRetry(feed.id, feed.name)}
                    />
                  }
                />
              )

              // While filtering, rows render without their sortable wrapper at
              // all — not merely without a handle. A SortableContext whose item
              // list is a filtered subset would compute indices against rows
              // that are not on screen.
              return draggable ? (
                <SortableFeed key={feed.id} id={feed.id} name={feed.name}>
                  {row}
                </SortableFeed>
              ) : (
                <div key={feed.id} className="min-w-0">
                  {row(<span aria-hidden="true" className="block size-5 shrink-0" />)}
                </div>
              )
            })

            const body = (
              <>
                {open && (
                  <div className="flex flex-col">
                    {draggable ? (
                      <FeedSortableContext folder={folder}>{feedRows}</FeedSortableContext>
                    ) : (
                      feedRows
                    )}

                    {folder.feeds.length === 0 && (
                      <p className="py-2 pl-9 text-xs text-zinc-600">
                        {folder.isRealFolder
                          ? "No feeds yet. Drag one here, or add one from the folder menu."
                          : "Every feed is in a folder."}
                      </p>
                    )}
                  </div>
                )}
              </>
            )

            const folderRow = (handle: ReactNode) => (
              <>
                <FolderRowView
                  folder={folder}
                  open={open}
                  onToggle={() => props.onToggleFolder(folder.id)}
                  attentionCount={attention}
                  isDropTarget={props.dropTargetId === folder.id}
                  handle={handle}
                  menu={
                    folder.isRealFolder ? (
                      <FolderMenu
                        folder={folder}
                        onAddFeed={() => props.onAddFeed(folder.id)}
                        onRename={() => props.onRenameFolder(folder)}
                        onShare={() => props.onShareFolder(folder)}
                        onManage={() => props.onManageFolder(folder)}
                        onRefresh={() => props.onRefreshFolder(folder)}
                        onDelete={() => props.onDeleteFolder(folder)}
                      />
                    ) : (
                      <span aria-hidden="true" className="block size-7" />
                    )
                  }
                />
                {body}
              </>
            )

            /*
              The whole folder — header and feeds — is the drop zone, so a feed
              can be dropped onto a collapsed folder or into an empty one. A
              SortableContext with no items has nothing to collide with.
            */
            // The spacer is not decoration: without it the Ungrouped bucket's
            // chevron sits a handle-width left of every other folder's.
            const spacer = <span aria-hidden="true" className="block size-5 shrink-0" />
            const wrapped = draggable ? (
              <FolderDropZone folderId={folder.id}>{folderRow(spacer)}</FolderDropZone>
            ) : (
              folderRow(spacer)
            )

            // The Ungrouped bucket is a destination, never a thing to reorder.
            return draggable && folder.isRealFolder ? (
              <SortableFolder key={folder.id} id={folder.id} name={folder.name}>
                {(handle) => (
                  <FolderDropZone folderId={folder.id}>{folderRow(handle)}</FolderDropZone>
                )}
              </SortableFolder>
            ) : (
              <div key={folder.id} className="min-w-0">
                {wrapped}
              </div>
            )
          })}

          {visible.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-zinc-600">
              Nothing matches “{props.filter}”.
            </p>
          )}
        </div>
      </section>

      {totalFeeds === 0 && (
        <Link
          to="/discover"
          className="flex items-center justify-center gap-2 rounded-2xl border border-dashed
            border-white/10 px-4 py-5 text-sm text-zinc-500 transition-colors
            hover:border-white/20 hover:text-zinc-200"
        >
          No sources yet. Browse the catalogue to add some.
        </Link>
      )}
    </div>
  )
}
