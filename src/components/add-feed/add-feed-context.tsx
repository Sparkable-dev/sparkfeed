import { invalidateWorkspace } from "@/lib/workspace-query"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useRouter } from "@tanstack/react-router"
import { AddFeedDialog } from "./AddFeedDialog"
import { useCommandAction } from "@/components/command/command-palette-context"
import { listFolderOptions } from "@/server/sources"

/**
 * One Add-sources dialog for the whole app.
 *
 * There used to be three, mounted separately in the shell, on /sources and in
 * the Discover hero, each passed a different set of props. So "add a feed"
 * behaved differently depending on which button you happened to press, the
 * command palette could only ever reach one of them, and the /sources copy had
 * to be remounted with a `key` to change its default folder.
 *
 * This mounts once, inside `CommandPaletteProvider` so it can publish its own
 * palette commands, and everything else just calls `openAddFeed`.
 */

export type AddFeedTab = "site" | "bulk"

export interface AddFeedOptions {
  /** Pre-fills the address field. Used by the Discover hero and chat cards. */
  url?: string
  /** Preselects a destination. Used by the per-folder menu on /sources. */
  folderId?: string | null
  tab?: AddFeedTab
}

export interface FolderOption {
  id: string
  name: string
}

interface AddFeedValue {
  openAddFeed: (options?: AddFeedOptions) => void
  /** False outside the provider, so a trigger can hide itself. */
  available: boolean
}

/**
 * A no-op default rather than a thrown "missing provider", matching
 * `command-palette-context`. The guest share page renders the same shell from
 * outside `_protected` and has nothing to add feeds to.
 */
const NOOP: AddFeedValue = { openAddFeed: () => {}, available: false }

const AddFeedContext = createContext<AddFeedValue>(NOOP)

export function useAddFeed(): AddFeedValue {
  return useContext(AddFeedContext)
}

/**
 * Registers a callback for "feeds were just added".
 *
 * For components with independent state, such as Discover's import progress.
 * Route-owned data updates through router.invalidate().
 */
const ChangeContext = createContext<{
  subscribe: (fn: () => void) => () => void
}>({ subscribe: () => () => {} })

export function useFeedsChanged(handler: () => void): void {
  const { subscribe } = useContext(ChangeContext)
  const latest = useRef(handler)
  latest.current = handler

  useEffect(() => subscribe(() => latest.current()), [subscribe])
}

export function AddFeedProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<AddFeedOptions>({})
  const [folders, setFolders] = useState<Array<FolderOption> | null>(null)

  const listeners = useRef(new Set<() => void>())
  const subscribe = useCallback((fn: () => void) => {
    listeners.current.add(fn)
    return () => {
      listeners.current.delete(fn)
    }
  }, [])

  /*
    Folders are fetched on first open rather than passed down. Every call site
    used to hand them in, from three different loaders in three different
    shapes; a dropdown does not need the whole workspace to have been loaded by
    whoever happened to open it.
  */
  const loadFolders = useCallback(async () => {
    try {
      setFolders(await listFolderOptions())
    } catch {
      // A picker with no folders still lets you add unfiled, which is better
      // than a dialog that refuses to open.
      setFolders([])
    }
  }, [])

  const openAddFeed = useCallback(
    (next: AddFeedOptions = {}) => {
      setOptions(next)
      setOpen(true)
      void loadFolders()
    },
    [loadFolders],
  )

  const notifyChanged = useCallback(() => {
    for (const fn of listeners.current) fn()
    void invalidateWorkspace(router)
    // A newly created folder has to appear in the picker the next time the
    // dialog opens.
    void loadFolders()
  }, [router, loadFolders])

  // Published here rather than by the shell, so the palette reaches the same
  // dialog as every button does.
  useCommandAction("add-feed", () => openAddFeed())
  useCommandAction("bulk-add-feeds", () => openAddFeed({ tab: "bulk" }))

  const value = useMemo<AddFeedValue>(
    () => ({ openAddFeed, available: true }),
    [openAddFeed],
  )
  const changeValue = useMemo(() => ({ subscribe }), [subscribe])

  return (
    <AddFeedContext.Provider value={value}>
      <ChangeContext.Provider value={changeValue}>
        {children}
        <AddFeedDialog
          open={open}
          onOpenChange={setOpen}
          options={options}
          folders={folders ?? []}
          onAdded={notifyChanged}
        />
      </ChangeContext.Provider>
    </AddFeedContext.Provider>
  )
}
