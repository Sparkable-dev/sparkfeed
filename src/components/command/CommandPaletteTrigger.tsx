import { useEffect, useState } from "react"
import { Search } from "lucide-react"
import { useCommandPalette } from "./command-palette-context"

/**
 * The top bar's centre. Looks like the input it replaced, but it is a button —
 * there is nothing to type into here, the palette owns the query.
 */
export function CommandPaletteTrigger() {
  const { openPalette, available } = useCommandPalette()

  /*
    The app server-renders, so reading `navigator` during render would produce
    "Ctrl" on the server and "⌘" on a Mac client and hydrate mismatched.
    Resolved after mount, in a fixed-width slot so the swap causes no reflow.
  */
  const [isMac, setIsMac] = useState<boolean | null>(null)
  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/i.test(navigator.userAgent))
  }, [])

  if (!available) return null

  return (
    <button
      type="button"
      id="command-palette-trigger"
      onClick={openPalette}
      aria-label="Open the command palette"
      aria-keyshortcuts="Meta+K Control+K"
      className="flex h-8 w-full items-center gap-2 rounded-lg border border-zinc-700/60 bg-zinc-900/40
        pr-2 pl-3 text-xs text-zinc-500 transition-colors hover:border-zinc-600 hover:text-zinc-300"
    >
      <Search className="size-3.5 shrink-0" />
      <span className="truncate">Jump to anything…</span>
      <kbd
        className="ml-auto flex w-10 shrink-0 items-center justify-center gap-0.5 rounded border
          border-zinc-700/60 bg-zinc-900 px-1.5 py-0.5 font-sans text-[10px] text-zinc-500"
      >
        {isMac === null ? "" : isMac ? "⌘K" : "^K"}
      </kbd>
    </button>
  )
}
