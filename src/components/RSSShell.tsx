import { useCallback, useEffect, useMemo, useState } from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import { useNavigate, useRouter } from "@tanstack/react-router"
import { AlertTriangle, Check, ChevronDown, Lock } from "lucide-react"
import { toast } from "sonner"
import type {ManageTarget} from "@/components/folder/ManageModal";
import type { FeedRow, FolderRow } from "@/lib/rss-types"
import type { ArticleRow } from "@/components/ArticleGrid"
import type {Crumb, HeaderAction} from "@/components/layout/header-actions";
import type { FavoriteScope } from "@/lib/workspace-scope"
import { invalidateWorkspace } from "@/lib/workspace-query"
import { useGuestShare } from "@/hooks/guest-share-context"
import { AppSidebar } from "@/components/app-sidebar"

import { SidebarInset, SidebarProvider, useSidebar } from "@/components/ui/sidebar"
import { useCommandAction } from "@/components/command/command-palette-context"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { ArticleGrid } from "@/components/ArticleGrid"
import { EditFeedModal } from "@/components/EditFeedModal"
import { FolderShareModal } from "@/components/FolderShareModal"
import { ManageModal  } from "@/components/folder/ManageModal"
import { deleteFeed, deleteFolder, renameFeed, renameFolder } from "@/server/rss"
import { DEMO_MODE } from "@/lib/demo"
import { useReaderStore } from "@/store/readerStore"
import { useAddFeed } from "@/components/add-feed/add-feed-context"
import { useFeedRefresh } from "@/hooks/useFeedRefresh"
import { useWorkspaceNavigation, useWorkspaceScope } from "@/components/WorkspaceDataProvider"
import { articlePagesQuery } from "@/lib/article-query"
import { RecoverFavorites } from "@/components/RecoverFavorites"
import { ArticleReaderProvider } from "@/components/ArticleReaderProvider"
import { AppTopBar } from "@/components/layout/AppTopBar"
import { CrumbMenu } from "@/components/layout/CrumbMenu"
import {


  addFeedAction,
  lastUpdatedNote,
  refreshAction,
  searchAction
} from "@/components/layout/header-actions"

// 0 means "All Time"
type DateFilterOption = 0 | 15 | 30 | 60 | 90

const DATE_FILTER_OPTIONS: Array<{ label: string; value: DateFilterOption }> = [
  { label: "All Time", value: 0 },
  { label: "Last 15 Days", value: 15 },
  { label: "Last 30 Days", value: 30 },
  { label: "Last 60 Days", value: 60 },
  { label: "Last 90 Days", value: 90 },
]

interface RSSShellProps {
  initialData: {
    folders: Array<FolderRow>
    feeds: Array<FeedRow>
    articles: Array<ArticleRow>
    /** Set when the server could load feeds but not articles. */
    degraded?: boolean
    counts?: { feeds: Record<string, number>; folders: Record<string, number>; total: number; today: number }
    favorites?: { personal: Array<string> }
  }
  /** Label for the current view (feed name, folder name, or "All Articles") */
  title: string
  /** When viewing a feed, pass the parent folder name to show "Folder › Feed" */
  folderName?: string
  /** URL slug of the parent folder (needed for breadcrumb link) */
  folderSlug?: string
  /** Called with enriched articles; return the filtered subset for this view */
  filterArticles?: (articles: Array<ArticleRow>, feeds: Array<FeedRow>) => Array<ArticleRow>
  /** Optional folderId for targeted refresh */
  folderId?: string
  /** Optional feedId for targeted actions */
  feedId?: string
  /**
   * When true the date-range filter is hidden and bypassed.
   * Use on routes like Today and Favorites that have their own fixed filter.
   */
  skipDateFilter?: boolean
  favoritesView?: boolean
  favoriteScope?: FavoriteScope
  onFavoriteScopeChange?: (scope: FavoriteScope) => void
  articleDays?: number
  /**
   * Breadcrumb ancestors, outermost first. `title` is always the leaf, so this
   * holds only what comes before it — `[{ label: "Discover", href: "/discover" }]`
   * renders as "Discover › Gaming".
   *
   * A feed page does not need this: `folderName` + `folderSlug` already say the
   * same thing, and the shell derives the ancestor from them.
   */
  crumbs?: Array<Crumb>
  /**
   * Top-bar controls for a page that brings its own body.
   *
   * Article pages get the toolbar the shell builds for them — search, date
   * range, refresh, add feed. A page passing `children` gets nothing, which is
   * right for a reading page and wrong for a working one: /sources grew its own
   * strip of buttons under its own heading, so the same class of control sat in
   * two different places depending on which page you were on.
   *
   * Described, not rendered, for the reason in `header-actions.tsx` — the bar
   * projects each action at both desktop and mobile widths, and a page handing
   * over JSX would only ever get one of them right.
   */
  actions?: Array<HeaderAction>
  /** Home shares the article pages' refresh status and action. */
  showRefreshControls?: boolean
  /**
   * Rendered immediately after `title` in the breadcrumb. Intended for a
   * switcher — a leaf page often wants to offer its siblings without spending a
   * whole strip on them.
   */
  titleMenu?: React.ReactNode
  /**
   * Rendered in place of ArticleGrid's "no articles" line when the workspace is
   * genuinely empty. Not the same as the filtered list being empty — see where
   * this is passed down.
   */
  emptyState?: React.ReactNode
  children?: React.ReactNode
}

/**
 * Publishes "Toggle sidebar" to the palette.
 *
 * A component rather than a hook call in `RSSShell` because `useSidebar` reads
 * a context that `SidebarProvider` — rendered by `RSSShell` itself — supplies,
 * so the shell is outside its own provider.
 */
function SidebarToggleCommand() {
  const { toggleSidebar } = useSidebar()
  useCommandAction("toggle-sidebar", toggleSidebar)
  return null
}

function enrichArticles(
  rawArticles: Array<ArticleRow>,
  feeds: Array<FeedRow>
): Array<ArticleRow> {
  const feedNameMap = Object.fromEntries(feeds.map((f) => [f.id, f.name]))
  return rawArticles.map((a) => ({
    ...a,
    feedName: a.feedId ? feedNameMap[a.feedId] : undefined,
    domain: (() => {
      try {
        return new URL(a.link).hostname.replace("www.", "")
      } catch {
        return a.link
      }
    })(),
  }))
}

/**
 * Collapses the same story arriving from more than one feed.
 *
 * A site's main feed carries everything its section feeds carry, so subscribing
 * to "The Verge" plus "Tech" plus "Gaming" showed popular stories two or three
 * times over. Applied only after the route filter, so a single-feed view is
 * untouched: one feed never repeats a link within itself.
 */
function dedupeByLink(articles: Array<ArticleRow>): Array<ArticleRow> {
  const seen = new Set<string>()
  return articles.filter((a) => {
    if (!a.link) return true
    if (seen.has(a.link)) return false
    seen.add(a.link)
    return true
  })
}

function applyDateFilter(
  articles: Array<ArticleRow>,
  filter: DateFilterOption
): Array<ArticleRow> {
  if (filter === 0) return articles
  const cutoff = new Date(Date.now() - filter * 24 * 60 * 60 * 1000)
  return articles.filter((a) => {
    // Fallback to createdAt if publishedAt is missing
    const dateStr = a.publishedAt || a.createdAt
    if (!dateStr) return true // Show articles with no dates at all
    return new Date(dateStr) >= cutoff
  })
}

export function RSSShell({
  initialData,
  title,
  folderName,
  folderSlug,
  filterArticles,
  folderId,
  feedId,
  skipDateFilter = false,
  favoritesView = false,
  favoriteScope: selectedFavoriteScope,
  onFavoriteScopeChange,
  articleDays,
  crumbs,
  actions: pageActions,
  showRefreshControls = false,
  titleMenu,
  emptyState,
  children,
}: RSSShellProps) {
  // The route loader owns server data. Copying it into state hid invalidations.
  const scope = useWorkspaceScope()
  const navigation = useWorkspaceNavigation()
  const localFavorites = useReaderStore((state) => state.favorites)
  const counts = navigation.data?.counts ?? initialData.counts
  const { folders, feeds, degraded = false } = navigation.data ?? initialData
  const router = useRouter()
  const [editFeedOpen, setEditFeedOpen] = useState(false)
  const [editingFeed, setEditingFeed] = useState<FeedRow | null>(null)
  const [search, setSearch] = useState("")
  const [dateFilter, setDateFilter] = useState<DateFilterOption>(15)
  const [localFavoriteScope, setLocalFavoriteScope] = useState<FavoriteScope>("personal")
  const favoriteScope = selectedFavoriteScope ?? localFavoriteScope
  const setFavoriteScope = onFavoriteScopeChange ?? setLocalFavoriteScope
  const [debouncedSearch, setDebouncedSearch] = useState(search)
  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), 250)
    return () => clearTimeout(timeout)
  }, [search])
  const pages = useInfiniteQuery({
    ...articlePagesQuery(scope ?? { userId: "guest", workspaceId: "guest" }, {
      feedId, folderId, favorites: favoritesView ? favoriteScope : undefined,
      days: favoritesView ? 0 : articleDays ?? (skipDateFilter ? 0 : dateFilter), query: debouncedSearch,
      demoFavoriteIds: DEMO_MODE && favoritesView ? localFavorites.slice(0, 500) : undefined,
    }),
    enabled: !!scope && !children && (!favoritesView || favoriteScope !== "workspace" || !!navigation.data?.favorites.workspaceEnabled),
  })
  const rawArticles = useMemo(() => scope && !children ? pages.data?.pages.flatMap((page) => page.items) ?? [] : initialData.articles, [scope, children, pages.data, initialData.articles])
  const [shareModalFolder, setShareModalFolder] = useState<{ type?: 'folder' | 'feed'; id: string; name: string; isPublic: boolean } | null>(null)
  const [renameData, setRenameData] = useState<{ type: 'folder' | 'feed', id: string, name: string } | null>(null)
  const [newFolderName, setNewFolderName] = useState("")
  const [deleteData, setDeleteData] = useState<{ type: 'folder' | 'feed'; id: string; name: string } | null>(null)
  const [manageTarget, setManageTarget] = useState<ManageTarget | null>(null)
  const favorites = useReaderStore((s) => s.favorites)
  const navigate = useNavigate()
  const guest = useGuestShare()
  const { openAddFeed } = useAddFeed()

  // Unguarded, a rejection here escapes into the router's error boundary and
  // takes the whole page down. Refreshing a list should never be able to do
  // that; surface it as a toast and keep the current data on screen.
  const reload = useCallback(async () => {
    // Guests keep the public-share payload and never trigger workspace reloads.
    if (guest) return
    try {
      await invalidateWorkspace(router)
    } catch (e) {
      console.error("[RSSShell] Failed to reload data:", e)
      toast.error("Could not refresh your feeds. Please try again.")
    }
  }, [guest, router])

  const { refreshing, refresh: handleRefresh } = useFeedRefresh({
    feeds,
    enabled: !guest && !DEMO_MODE,
    folderId,
    feedId,
    onRefreshed: reload,
  })

  const handleEditFeed = (feed: FeedRow) => {
    setEditingFeed(feed)
    setEditFeedOpen(true)
  }

  const handleShare = (id: string, name: string) => {
    if (DEMO_MODE) { toast.warning("Feature locked in demo mode"); return }
    const f = folders.find((folder) => folder.id === id)
    if (f) {
      setShareModalFolder({ type: 'folder', id, name, isPublic: f.isShared === true })
    }
  }

  const handleShareFeed = (id: string, name: string) => {
    if (DEMO_MODE) { toast.warning("Feature locked in demo mode"); return }
    const f = feeds.find((feed) => feed.id === id)
    if (f) {
      setShareModalFolder({ type: 'feed', id, name, isPublic: (f as any).isShared === true })
    }
  }

  const handleRename = (id: string, name: string) => {
    if (DEMO_MODE) { toast.warning("Feature locked in demo mode"); return }
    setRenameData({ type: 'folder', id, name })
    setNewFolderName(name)
  }

  const handleRenameFeed = (id: string, name: string) => {
    if (DEMO_MODE) { toast.warning("Feature locked in demo mode"); return }
    setRenameData({ type: 'feed', id, name })
    setNewFolderName(name)
  }

  const handleRenameConfirm = async () => {
    if (!renameData || !newFolderName || newFolderName === renameData.name) {
      setRenameData(null)
      return
    }
    try {
      if (renameData.type === 'folder') {
        await renameFolder({ data: { id: renameData.id, name: newFolderName } })
      } else {
        await renameFeed({ data: { id: renameData.id, name: newFolderName } })
      }
      setRenameData(null)
      reload()
    } catch (error) {
      toast.error(`Failed to rename ${renameData.type}`)
    }
  }

  const handleDelete = (id: string, name: string) => {
    if (DEMO_MODE) { toast.warning("Feature locked in demo mode"); return }
    setDeleteData({ type: 'folder', id, name })
  }

  const handleDeleteFeed = (id: string, name: string) => {
    if (DEMO_MODE) { toast.warning("Feature locked in demo mode"); return }
    setDeleteData({ type: 'feed', id, name })
  }

  const handleDeleteConfirm = async () => {
    if (!deleteData) return
    try {
      if (deleteData.type === 'folder') {
        await deleteFolder({ data: { id: deleteData.id } })
        setDeleteData(null)
        // Navigate away from the deleted folder page
        navigate({ to: '/' })
        reload()
      } else {
        await deleteFeed({ data: { id: deleteData.id } })
        setDeleteData(null)
        reload()
      }
      toast.success(`${deleteData.type === 'folder' ? 'Folder' : 'Feed'} deleted`)
    } catch (err) {
      console.error(err)
      toast.error(`Failed to delete ${deleteData.type}`)
      setDeleteData(null)
    }
  }

  // Enrich all articles with domain + feedName
  const allArticles = useMemo(() => enrichArticles(rawArticles, feeds), [rawArticles, feeds])

  // 1. Calculate the "base" list of articles that respect the CURRENT date filter.
  // This list is used for badges/counts so they match what the user sees in the views.
  const dateFilteredAll = skipDateFilter
    ? allArticles
    : applyDateFilter(allArticles, dateFilter)

  // 2. Apply the route-specific filter (e.g. folder / feed / bookmarks)
  const routeFiltered = filterArticles ? filterArticles(allArticles, feeds) : allArticles

  // 3. Final displayed articles (Grid) — date filter, then dedupe, then search
  const dateFiltered = dedupeByLink(
    skipDateFilter ? routeFiltered : applyDateFilter(routeFiltered, dateFilter),
  )

  const displayedArticles = search
    ? dateFiltered.filter((a) => {
      const q = search.toLowerCase()
      return (
        a.title.toLowerCase().includes(q) ||
        (a.domain ?? "").includes(q) ||
        (a.feedName ?? "").toLowerCase().includes(q)
      )
    })
    : dateFiltered

  // 4. Counts per feed (for sidebar badges) — use the date-filtered base.
  // Not deduped: one feed never repeats a link, so this is what the feed's own
  // view will show.
  const articleCounts: Record<string, number> = {}
  for (const a of dateFilteredAll) {
    if (a.feedId) {
      articleCounts[a.feedId] = (articleCounts[a.feedId] ?? 0) + 1
    }
  }

  // Folder badges cannot just sum their feeds: sibling feeds from the same site
  // overlap, so the sum overstates what the folder view actually renders. Count
  // distinct links per folder instead.
  const folderOfFeed = new Map(feeds.map((f) => [f.id, f.folderId]))
  const linksPerFolder: Record<string, Set<string>> = {}
  for (const a of dateFilteredAll) {
    const folder = a.feedId ? folderOfFeed.get(a.feedId) : null
    if (!folder || !a.link) continue
    ;(linksPerFolder[folder] ??= new Set()).add(a.link)
  }
  const folderArticleCounts: Record<string, number> = {}
  for (const [folder, links] of Object.entries(linksPerFolder)) {
    folderArticleCounts[folder] = links.size
  }

  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000)

  // The "All articles" badge uses the date-filtered base, deduped so it matches the
  // number of cards actually rendered. Per-feed counts above stay un-deduped:
  // a feed really does carry that many articles.
  const totalCount = dedupeByLink(dateFilteredAll).length

  // Today and Favorites ignore the global date filter because they own their cutoff
  const todayCount = allArticles.filter((a) => {
    const d = a.publishedAt || a.createdAt
    return d && new Date(d) >= last24h
  }).length
  const favoritesCount = allArticles.filter(
    (a) => favorites.includes(a.id) || a.isFavorite
  ).length

  const selectedOption = DATE_FILTER_OPTIONS.find(
    (o) => o.value === dateFilter
  )!

  // ─────────────────────────────────────────────
  // Top bar configuration
  // ─────────────────────────────────────────────

  /*
    Pages that render `children` bring their own body and their own controls, so
    they get the breadcrumb and the palette but an empty action slot. Article
    pages get the toolbar.
  */
  const isArticlePage = !children

  const ancestors: Array<Crumb> =
    crumbs ??
    (folderName && folderSlug ? [{ label: folderName, href: `/${folderSlug}` }] : [])
  const headerCrumbs: Array<Crumb> = [...ancestors, { label: title }]

  const dateFilterControl: HeaderAction = {
    kind: "custom",
    id: "date-filter",
    node: (
      <DropdownMenu>
        <DropdownMenuTrigger
          id="date-filter-btn"
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border dark:border-zinc-700/60
            bg-card dark:bg-zinc-900/40 px-3 text-xs font-medium text-foreground dark:text-zinc-300 transition-all hover:bg-accent dark:hover:bg-zinc-800 hover:text-foreground dark:hover:text-white"
        >
          {selectedOption.label}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="min-w-[160px] rounded-xl border border-border dark:border-zinc-700/60 bg-card dark:bg-[#0a0a0a] p-1 text-foreground dark:text-zinc-200 shadow-2xl"
        >
          {DATE_FILTER_OPTIONS.map((opt) => {
            const active = dateFilter === opt.value
            return (
              <DropdownMenuItem
                key={String(opt.value)}
                id={`filter-${opt.value}`}
                onClick={() => setDateFilter(opt.value)}
                className={[
                  "flex cursor-pointer items-center justify-between rounded-lg px-3 py-1.5 text-xs transition-colors",
                  active
                    ? "font-medium text-blue-700 dark:text-blue-400 focus:bg-blue-500/10 focus:text-blue-700 dark:focus:text-blue-400"
                    : "text-muted-foreground dark:text-zinc-400 hover:text-foreground dark:hover:text-white focus:bg-accent dark:focus:bg-zinc-800",
                ].join(" ")}
              >
                {opt.label}
                {active && <Check className="h-3.5 w-3.5 text-blue-700 dark:text-blue-400" />}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  }

  /*
    Scoped to what the page actually shows, so a feed page reports that feed's
    freshness rather than the workspace's. Refresh is scoped the same way
    (`handleRefresh` targets `folderId` when set), so the number and the button
    beside it are talking about the same set of feeds.
  */
  const feedsInView = feedId
    ? feeds.filter((f) => f.id === feedId)
    : folderId
      ? feeds.filter((f) => f.folderId === folderId)
      : feeds

  const headerActions: Array<HeaderAction> = []
  if (isArticlePage) {
    const updated = lastUpdatedNote(feedsInView)
    if (updated) headerActions.push(updated)
    if (!skipDateFilter) headerActions.push(dateFilterControl)
    headerActions.push(searchAction(search, setSearch))
    // Refreshing someone else's workspace, and adding to it, are not a guest's
    // to do. Search stays: it is client-side over data they already hold.
    if (!guest) {
      headerActions.push(refreshAction(handleRefresh, refreshing, feedId ? "Refresh feed" : folderId ? "Refresh folder" : "Refresh all feeds"))
      if (!favoritesView) headerActions.push(addFeedAction(() => openAddFeed()))
      else headerActions.push({ kind: "custom", id: "favorite-scope", alwaysVisible: true, node: (
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex h-8 items-center gap-2 rounded-lg border px-3 text-xs">
            <span>{favoriteScope === "personal" ? "Personal" : "Workspace"}<span className="hidden sm:inline"> favorites</span></span><ChevronDown className="size-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setFavoriteScope("personal")}>Personal favorites</DropdownMenuItem>
            <DropdownMenuItem disabled={!navigation.data?.favorites.workspaceEnabled} onClick={() => setFavoriteScope("workspace")}>
              Workspace favorites {!navigation.data?.favorites.workspaceEnabled && <Lock className="ml-2 size-3" />}
            </DropdownMenuItem>
            {!navigation.data?.favorites.workspaceEnabled && <p className="max-w-56 px-2 py-1 text-xs text-muted-foreground">Available in Pro and Enterprise team workspaces.</p>}
          </DropdownMenuContent>
        </DropdownMenu>
      ) })
    }
  } else if (pageActions && !guest) {
    // A guest is looking at someone else's workspace. Nothing a page puts in
    // this slot is theirs to do, and the shell already withholds its own.
    headerActions.push(...pageActions)
  }

  /*
    A page-supplied switcher wins the slot. Both hang off the leaf crumb and
    only one chevron can, so a page that offers its siblings (a Discover
    category) is choosing that over folder management it does not have anyway.
  */
  const headerMenu = titleMenu ?? (guest ? null : (
    <CrumbMenu
      label={title}
      folderId={folderId}
      feedId={feedId}
      onManage={
        folderId
          ? () => setManageTarget({ kind: "folder", id: folderId, name: folderName ?? title })
          : undefined
      }
      onManageFeed={
        feedId
          ? () => setManageTarget({ kind: "feed", id: feedId, name: title, folderId })
          : undefined
      }
      onShare={handleShare}
      onRename={handleRename}
      onDelete={handleDelete}
      onShareFeed={handleShareFeed}
      onRenameFeed={handleRenameFeed}
      onDeleteFeed={handleDeleteFeed}
    />
  ))

  /*
    Guests have no palette (their route sits outside the provider) and no
    permission to do any of this, so nothing is published for them.

    "add-feed" is not published here: the provider that owns the dialog
    registers it, so the palette and this bar open the same thing.
  */
  useCommandAction("refresh-all", guest ? null : () => void handleRefresh())

  if (showRefreshControls && !isArticlePage && !guest) {
    headerActions.push(lastUpdatedNote(feeds) ?? { kind: "note", id: "last-updated", text: "Not updated yet" })
    headerActions.push(refreshAction(handleRefresh, refreshing))
  }

  return (
    <ArticleReaderProvider>
    <SidebarProvider>
      {/* `useSidebar` only resolves inside the provider, hence a child. */}
      <SidebarToggleCommand />
      <AppSidebar
        folders={folders}
        feeds={feeds}
        articleCounts={counts?.feeds ?? articleCounts}
        folderArticleCounts={counts?.folders ?? folderArticleCounts}
        totalCount={counts?.total ?? totalCount}
        todayCount={counts?.today ?? todayCount}
        favoritesCount={DEMO_MODE ? localFavorites.length : navigation.data?.favorites.personal.length ?? initialData.favorites?.personal.length ?? favoritesCount}
        onFolderCreated={reload}
        onEditFeed={handleEditFeed}
      />
      <SidebarInset>
        <AppTopBar
          crumbs={headerCrumbs}
          crumbMenu={headerMenu}
          actions={headerActions}
        />

        {refreshing && (
          <p role="status" className="mx-4 mb-2 text-xs text-muted-foreground">
            Checking sources for new articles. You can keep reading.
          </p>
        )}

        {degraded && (
          <div className="mx-4 mb-2 flex items-center gap-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>
              Your articles could not be loaded right now. Your feeds are safe. Try refreshing in a
              moment.
            </span>
          </div>
        )}

        {/*
          No `overflow` here, deliberately.

          It used to be `overflow-hidden`, which looked harmless because nothing
          in this subtree ever actually scrolls — the shell's height is
          content-derived (`min-h-svh` is a floor, not a cap), so the document is
          the real scroller. But *any* overflow value other than `visible` makes
          an element a scroll container, and `position: sticky` anchors to the
          nearest one. So every sticky descendant was pinned to a box that never
          moves, and silently did nothing. Horizontal containment is handled by
          `min-w-0` on SidebarInset, which is the correct tool for it.
        */}
        <div className="flex min-w-0 flex-1 flex-col">
          {favoritesView && favoriteScope === "personal" && !DEMO_MODE && <RecoverFavorites />}
          {!!scope && !children && pages.isError && <div role="alert" className="m-5 flex items-center gap-3 text-sm text-amber-700 dark:text-amber-400">
            Articles could not be loaded. Your saved favorites are safe.
            <Button variant="outline" onClick={() => void pages.refetch()}>Retry</Button>
          </div>}
          {children || (
            <ArticleGrid
              articles={displayedArticles}
              title={title}
              // rawArticles, not displayedArticles: the date filter defaults to
              // 15 days and there is a search box, so gating on the filtered
              // list would ambush an existing user whose search missed with a
              // full catalogue. Explain active filters separately.
              emptyState={
                !!scope && pages.isPending ? <p role="status" className="p-8 text-center text-sm text-muted-foreground">Loading articles…</p> :
                rawArticles.length === 0 && emptyState ? emptyState :
                refreshing && displayedArticles.length === 0 ? (
                  <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
                    Checking your sources for new articles…
                  </div>
                ) : displayedArticles.length === 0 && (routeFiltered.length > 0 || (!!scope && !favoritesView && !skipDateFilter)) ? (
                  <div className="flex h-64 flex-col items-center justify-center gap-3">
                    <p className="text-sm text-muted-foreground">
                      No articles match your {search ? "search" : "date range"}.
                    </p>
                    <Button variant="outline" onClick={() => { setSearch(""); setDateFilter(0) }}>
                      Clear filters and show saved articles
                    </Button>
                  </div>
                ) : undefined
              }
              folderId={folderId}
              onRefreshed={reload}
            />
          )}
          {!!scope && !children && pages.hasNextPage && <div className="flex justify-center p-6">
            <Button variant="outline" disabled={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>
              {pages.isFetchingNextPage ? "Loading…" : "Load more articles"}
            </Button>
          </div>}
        </div>
      </SidebarInset>

      {/*
        Every trigger for these is hidden for a guest, so mounting them would
        just leave unreachable dialogs in the tree, each holding auth-only
        server functions.

        Add-sources is not among them any more: it is mounted once for the whole
        app in `_protected.tsx`, which is what makes it behave identically from
        the top bar, the palette, /sources and Discover. See `add-feed-context`.
      */}
      {guest ? null : (
      <>
      <EditFeedModal
        open={editFeedOpen}
        onOpenChange={(open) => {
          setEditFeedOpen(open)
          if (!open) setEditingFeed(null)
        }}
        folders={folders}
        onFeedUpdated={reload}
        editingFeed={editingFeed}
      />

      <ManageModal
        target={manageTarget}
        folders={folders}
        feeds={feeds}
        open={manageTarget !== null}
        onOpenChange={(next) => { if (!next) setManageTarget(null) }}
        onChanged={reload}
      />

      <FolderShareModal
        folderId={shareModalFolder?.id ?? ""}
        folderName={shareModalFolder?.name ?? ""}
        isPublic={shareModalFolder?.isPublic ?? false}
        isOpen={shareModalFolder !== null}
        type={shareModalFolder?.type ?? 'folder'}
        onClose={() => setShareModalFolder(null)}
      />

      <Dialog
        open={renameData !== null}
        onOpenChange={() => setRenameData(null)}
      >
        <DialogContent className="bg-card dark:bg-zinc-900 border-border dark:border-zinc-800">
          <DialogHeader>
            <DialogTitle className="text-foreground dark:text-white">
              Rename {renameData?.type === 'feed' ? 'Feed' : 'Folder'}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground dark:text-zinc-400">
              Enter a new name for "{renameData?.name}"
            </DialogDescription>
          </DialogHeader>
          <Input
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            className="bg-card dark:bg-zinc-950 border-input dark:border-zinc-800 text-foreground dark:text-white"
            placeholder="Folder name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRenameConfirm()
            }}
          />
          <DialogFooter>
            <Button
              variant="outline"
              className="border-border dark:border-zinc-700 text-foreground dark:text-zinc-300"
              onClick={() => setRenameData(null)}
            >
              Cancel
            </Button>
            <Button
              className="bg-primary dark:bg-white text-primary-foreground dark:text-black hover:bg-primary/90 dark:hover:bg-zinc-200"
              onClick={handleRenameConfirm}
            >
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteData} onOpenChange={(open) => !open && setDeleteData(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the {deleteData?.type} <strong>{deleteData?.name}</strong>.
              {deleteData?.type === 'folder'
                ? ' All feeds and articles inside this folder will also be deleted.'
                : ' All articles inside this feed will also be deleted.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border dark:border-white/10 text-muted-foreground dark:text-zinc-400 hover:bg-accent dark:hover:bg-white/5 hover:text-foreground dark:hover:text-white">
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
      </>
      )}

    </SidebarProvider>
    </ArticleReaderProvider>
  )
}
