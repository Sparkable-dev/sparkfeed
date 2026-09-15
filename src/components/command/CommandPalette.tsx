import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { Command as CommandPrimitive } from "cmdk"
import {
  ChevronRight,
  CornerDownLeft,
  FileText,
  Folder as FolderIcon,
  ListPlus,
  PanelLeft,
  Plus,
  RefreshCw,
  Rss,
  Search,
  Telescope,
} from "lucide-react"
import { useCommandPalette } from "./command-palette-context"
import type {NavIndex} from "@/server/nav-index";
import type {CommandActionId, PaletteItem, Scope} from "@/lib/command-index";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {  getNavIndex } from "@/server/nav-index"
import { slugify } from "@/lib/slugify"
import { NAV_PAGES, SECONDARY_PAGES } from "@/config/nav-pages"
import {

  FIXED_SCOPES,


  UNSCOPED_GROUP_LIMIT,
  parseDrill,
  rank
} from "@/lib/command-index"

const ACTION_META: Record<CommandActionId, { label: string; icon: typeof Plus }> = {
  "add-feed": { label: "Add feed", icon: Plus },
  "bulk-add-feeds": { label: "Add several feeds at once", icon: ListPlus },
  "refresh-all": { label: "Refresh all feeds", icon: RefreshCw },
  "new-folder": { label: "New folder", icon: FolderIcon },
  "toggle-sidebar": { label: "Toggle sidebar", icon: PanelLeft },
}

const EMPTY_INDEX: NavIndex = { folders: [], feeds: [], categories: [] }

/** Static, so they are built once rather than per keystroke. */
const PAGE_ITEMS: Array<PaletteItem> = [
  ...NAV_PAGES.map((page) => ({
    kind: "nav" as const,
    id: `page:${page.href}`,
    label: page.title,
    to: page.href,
    keywords: [page.title],
  })),
  ...SECONDARY_PAGES.map((page) => ({
    kind: "nav" as const,
    id: `page:${page.href}`,
    label: page.title,
    sublabel: page.section,
    to: page.href,
    keywords: [page.title, page.section],
  })),
]

/**
 * Jump to anything, or run a command. ⌘K.
 *
 * Mounted once by the provider rather than per route, so its query and its
 * loaded index survive navigation.
 */
export function CommandPalette() {
  const { open, setOpen, getActions } = useCommandPalette()
  const navigate = useNavigate()

  const [query, setQuery] = useState("")
  const [scope, setScope] = useState<Scope | null>(null)
  const [index, setIndex] = useState<NavIndex>(EMPTY_INDEX)
  /** cmdk's highlighted row, controlled so `→` knows what to drill into. */
  const [active, setActive] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  /*
    Fetched per open, but the previous result stays on screen meanwhile — a
    palette that blanks for 200ms every time you summon it feels broken even
    when it is merely fresh.
  */
  useEffect(() => {
    if (!open) return
    let cancelled = false
    getNavIndex()
      .then((next) => {
        if (!cancelled) setIndex(next)
      })
      .catch(() => {
        // A failed refresh leaves the last good index in place. Navigation
        // targets going one cycle stale beats an empty palette.
      })
    return () => {
      cancelled = true
    }
  }, [open])

  // Closing resets the query but keeps the index — see above.
  useEffect(() => {
    if (!open) {
      setQuery("")
      setScope(null)
    }
  }, [open])

  const actions = open ? getActions() : new Map<CommandActionId, () => void>()

  // ───────────────────────────────────────────
  // Items
  // ───────────────────────────────────────────

  const folderOf = useMemo(
    () => new Map(index.folders.map((f) => [f.id, f.name])),
    [index.folders],
  )

  const folderItems = useMemo<Array<PaletteItem>>(
    () =>
      index.folders.map((folder) => ({
        kind: "folder",
        id: `folder:${folder.id}`,
        folderId: folder.id,
        label: folder.name,
        to: `/${slugify(folder.name)}`,
        keywords: [folder.name],
      })),
    [index.folders],
  )

  const feedItems = useMemo<Array<PaletteItem>>(
    () =>
      index.feeds.map((feed) => {
        const parent = feed.folderId ? folderOf.get(feed.folderId) : null
        return {
          kind: "nav",
          id: `feed:${feed.id}`,
          label: feed.name,
          sublabel: parent ?? undefined,
          /* Slugs are derived from names, never stored — same rule the routes use. */
          to: parent
            ? `/${slugify(parent)}/${slugify(feed.name)}`
            : `/feed/${slugify(feed.name)}`,
          keywords: [feed.name, parent ?? ""].filter(Boolean),
        }
      }),
    [index.feeds, folderOf],
  )

  const categoryItems = useMemo<Array<PaletteItem>>(
    () =>
      index.categories.map((category) => ({
        kind: "nav",
        id: `category:${category.slug}`,
        label: category.name,
        sublabel: "Discover",
        to: `/discover/${category.slug}`,
        keywords: [category.name, "discover"],
      })),
    [index.categories],
  )

  const actionItems = useMemo<Array<PaletteItem>>(
    () =>
      [...actions.keys()].map((id) => ({
        kind: "action",
        id: `action:${id}`,
        actionId: id,
        label: ACTION_META[id].label,
        keywords: [ACTION_META[id].label],
      })),
    // `actions` is read from a ref, so this recomputes when the palette opens.
    [open, actions.size],
  )

  // ───────────────────────────────────────────
  // Query handling
  // ───────────────────────────────────────────

  const trimmed = query.trim()

  function handleQueryChange(next: string) {
    if (!scope) {
      const drill = parseDrill(next, index.folders)
      if (drill) {
        setScope(drill.scope)
        setQuery(drill.rest)
        return
      }
    }
    setQuery(next)
  }

  function enterScope(next: Scope) {
    setScope(next)
    setQuery("")
    inputRef.current?.focus()
  }

  function run(item: PaletteItem) {
    if (item.kind === "action") {
      const fn = getActions().get(item.actionId)
      setOpen(false)
      fn?.()
      return
    }
    setOpen(false)
    void navigate({ to: item.to as never })
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    // Backspace at the very start drops the pill, the way every scoped search
    // box people already use behaves.
    if (event.key === "Backspace" && query === "" && scope) {
      event.preventDefault()
      setScope(null)
      return
    }

    // `→` drills into the highlighted folder; Enter still navigates to it.
    // Splitting the two is what keeps "open this folder" one keystroke while
    // making "look inside it" available without leaving the palette.
    if ((event.key === "ArrowRight" || event.key === "Tab") && !scope) {
      const folder = folderItems.find((f) => f.id === active)
      if (folder && folder.kind === "folder") {
        event.preventDefault()
        enterScope({ kind: "folder", id: folder.folderId, label: folder.label })
      }
    }
  }

  // ───────────────────────────────────────────
  // What to show
  // ───────────────────────────────────────────

  const groups: Array<{ heading: string; items: Array<PaletteItem> }> = []

  if (scope?.kind === "folder") {
    const inFolder = feedItems.filter((item) =>
      index.feeds.some((f) => `feed:${f.id}` === item.id && f.folderId === scope.id),
    )
    groups.push({ heading: "Feeds", items: rank(inFolder, trimmed) })
  } else if (scope?.kind === "fixed") {
    const source =
      scope.id === "pages" ? PAGE_ITEMS : scope.id === "discover" ? categoryItems : actionItems
    groups.push({ heading: scope.label, items: rank(source, trimmed) })
  } else {
    const add = (heading: string, items: Array<PaletteItem>) => {
      const ranked = rank(items, trimmed, UNSCOPED_GROUP_LIMIT)
      if (ranked.length) groups.push({ heading, items: ranked })
    }
    add("Pages", PAGE_ITEMS)
    add("Folders", folderItems)
    add("Feeds", feedItems)
    add("Discover", categoryItems)
    add("Actions", actionItems)
  }

  const hasResults = groups.some((g) => g.items.length > 0)

  return (
    <CommandDialog
      open={open}
      /*
        Two-stage Escape. base-ui hands the reason for a close request and lets
        it be cancelled, so the first press can clear the scope pill and only
        the second closes the dialog. (Radix would need an onEscapeKeyDown
        interception here; this primitive does not.)
      */
      onOpenChange={(next, details) => {
        if (!next && details?.reason === "escape-key" && scope) {
          details.cancel()
          setScope(null)
          return
        }
        setOpen(next)
      }}
      title="Command palette"
      description="Jump to a folder, feed or page, or run a command."
      className="top-[15vh] translate-y-0 overflow-visible p-0 sm:max-w-xl"
    >
      {/*
        `shouldFilter={false}`: cmdk hides non-matching items internally rather
        than scoring them, so capping a group at five would be meaningless.
        Ranking happens above; cmdk keeps roving focus and selection.
      */}
      <Command
        shouldFilter={false}
        value={active}
        onValueChange={setActive}
        className="rounded-xl p-0"
      >
        <div className="flex items-center gap-2 border-b border-border dark:border-zinc-800 px-4">
          <Search className="size-4 shrink-0 text-muted-foreground dark:text-zinc-500" />
          {scope && (
            <span className="flex shrink-0 items-center gap-1.5 rounded-md bg-blue-500/10 px-2 py-1 text-xs font-medium text-blue-700 dark:text-blue-400">
              {scope.kind === "folder" ? <FolderIcon className="size-3" /> : <Telescope className="size-3" />}
              {scope.label}
            </span>
          )}
          <CommandPrimitive.Input
            ref={inputRef}
            autoFocus
            value={query}
            onValueChange={handleQueryChange}
            onKeyDown={handleKeyDown}
            placeholder={
              scope
                ? `Search ${scope.label}…`
                : "Jump to a folder, feed or page, or run a command…"
            }
            className="h-12 flex-1 bg-transparent text-sm text-foreground dark:text-zinc-100 outline-hidden placeholder:text-muted-foreground dark:placeholder:text-zinc-600"
          />
        </div>

        <CommandList className="max-h-[60vh] p-1">
          {!hasResults && (
            <CommandEmpty className="py-8 text-center text-sm text-muted-foreground dark:text-zinc-500">
              Nothing matches “{trimmed}”.
            </CommandEmpty>
          )}

          {groups.map((group) => (
            <CommandGroup key={group.heading} heading={group.heading}>
              {group.items.map((item) => {
                const Icon = iconFor(item)
                return (
                  <CommandItem
                    /* The id, never the label: cmdk collapses duplicate values
                       and two folders can hold feeds with the same name. */
                    key={item.id}
                    value={item.id}
                    onSelect={() => run(item)}
                    className="gap-2.5 text-foreground dark:text-zinc-200"
                  >
                    <Icon className="size-4 shrink-0 text-muted-foreground dark:text-zinc-500" />
                    <span className="shrink-0 truncate">{item.label}</span>
                    {item.sublabel && (
                      <span className="truncate text-xs text-muted-foreground dark:text-zinc-600">{item.sublabel}</span>
                    )}
                    {item.kind === "folder" && !scope && (
                      <span
                        data-slot="command-shortcut"
                        className="ml-auto flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground dark:text-zinc-600"
                      >
                        <ChevronRight className="size-3" />
                        feeds
                      </span>
                    )}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          ))}

          {!scope && !trimmed && (
            <CommandGroup heading="Narrow to">
              {FIXED_SCOPES.map((fixed) => (
                <CommandItem
                  key={fixed.id}
                  value={`scope:${fixed.id}`}
                  onSelect={() => enterScope({ kind: "fixed", id: fixed.id, label: fixed.label })}
                  className="gap-2.5 text-muted-foreground dark:text-zinc-400"
                >
                  <Telescope className="size-4 shrink-0 text-muted-foreground dark:text-zinc-600" />
                  {fixed.label}
                  <span
                    data-slot="command-shortcut"
                    className="ml-auto shrink-0 text-[10px] text-muted-foreground dark:text-zinc-600"
                  >
                    {fixed.label.toLowerCase()} &gt;
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>

        <div className="flex items-center gap-4 border-t border-border dark:border-zinc-800 px-4 py-2 text-[10px] text-muted-foreground dark:text-zinc-600">
          <span className="flex items-center gap-1">
            <CornerDownLeft className="size-3" /> open
          </span>
          <span>↑↓ move</span>
          <span>→ look inside a folder</span>
          <span className="ml-auto">esc {scope ? "clears" : "closes"}</span>
        </div>
      </Command>
    </CommandDialog>
  )
}

function iconFor(item: PaletteItem) {
  if (item.kind === "folder") return FolderIcon
  if (item.kind === "action") return ACTION_META[item.actionId].icon
  if (item.id.startsWith("feed:")) return Rss
  if (item.id.startsWith("category:")) return Telescope
  // Pages. Neutral on purpose — mirroring the sidebar's per-page icons would
  // mean a second copy of that mapping to keep in step for no real gain.
  return FileText
}
