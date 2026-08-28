import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { CommandPalette } from "./CommandPalette"
import type { CommandActionId } from "@/lib/command-index"

type CommandPaletteValue = {
  open: boolean
  setOpen: (open: boolean) => void
  openPalette: () => void
  /** True only inside a provider, so the trigger can hide itself elsewhere. */
  available: boolean
  /**
   * Publishes a handler the palette can run. Returns its own unregister.
   *
   * The palette sits above every page, so it cannot reach into a route to call
   * `setAddFeedOpen` or `toggleSidebar`. Pages push their handlers up instead,
   * and the palette lists only what is currently registered — which is also
   * how a guest or a settings page ends up offering fewer commands without
   * anyone writing that rule down.
   */
  registerAction: (id: CommandActionId, fn: () => void) => () => void
  getActions: () => Map<CommandActionId, () => void>
}

/**
 * Deliberately a no-op default rather than a thrown "missing provider".
 *
 * The guest share page at /sprk/:slug renders the same shell as every signed-in
 * route but lives outside `_protected`, so it has no provider — and throwing
 * would take down a page that simply has no palette.
 */
const NOOP: CommandPaletteValue = {
  open: false,
  setOpen: () => {},
  openPalette: () => {},
  available: false,
  registerAction: () => () => {},
  getActions: () => new Map(),
}

const CommandPaletteContext = createContext<CommandPaletteValue>(NOOP)

export function useCommandPalette() {
  return useContext(CommandPaletteContext)
}

/**
 * Registers a palette command for as long as the calling component is mounted.
 *
 * `fn` is read through a ref, so a handler that closes over changing state does
 * not need to be memoised and does not churn the registry on every render.
 */
export function useCommandAction(
  id: CommandActionId,
  fn: (() => void) | null,
) {
  const { registerAction } = useCommandPalette()
  const latest = useRef(fn)
  latest.current = fn

  useEffect(() => {
    if (!fn) return
    return registerAction(id, () => latest.current?.())
    // `fn` is intentionally not a dependency: only its presence matters, and
    // re-registering on every render would defeat the ref above.
  }, [id, registerAction, !fn])
}

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const actions = useRef(new Map<CommandActionId, () => void>())

  const registerAction = useCallback((id: CommandActionId, fn: () => void) => {
    actions.current.set(id, fn)
    return () => {
      /*
        The identity check is the whole point. React mounts the incoming
        route's subtree before unmounting the outgoing one, so a plain
        `delete(id)` in the old route's cleanup runs *after* the new route has
        already registered, and silently wipes it — the palette would lose
        "Refresh all" on every second navigation. Comparing against what is
        actually stored makes a late cleanup a no-op.
      */
      if (actions.current.get(id) === fn) actions.current.delete(id)
    }
  }, [])

  const getActions = useCallback(() => actions.current, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "k" || !(event.metaKey || event.ctrlKey)) return
      // Without this Firefox opens its own quick-find bar underneath.
      event.preventDefault()
      setOpen((prev) => !prev)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  const value = useMemo<CommandPaletteValue>(
    () => ({
      open,
      setOpen,
      openPalette: () => setOpen(true),
      available: true,
      registerAction,
      getActions,
    }),
    [open, registerAction, getActions],
  )

  return (
    <CommandPaletteContext.Provider value={value}>
      {children}
      <CommandPalette />
    </CommandPaletteContext.Provider>
  )
}
