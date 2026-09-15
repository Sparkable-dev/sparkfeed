import { Link } from "@tanstack/react-router"
import { FolderPlus, Plus, Sparkles, Telescope } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { CommandActionId } from "@/lib/command-index"
import { useCommandPalette } from "@/components/command/command-palette-context"

/**
 * The four things a person arrives wanting to do.
 *
 * Deliberately separate from the destination tiles further down the page.
 * These *do* something; those *go* somewhere. Interleaving the two is the
 * standard dashboard mistake and it makes both harder to scan, because the eye
 * cannot tell which tiles will navigate away and which will open a dialog.
 *
 * The two that open dialogs run through the command palette's action registry
 * rather than owning their own modal state. `AddFeedProvider` publishes
 * "add-feed" and `nav-folders` publishes "new-folder", so Home reuses the one
 * mounted instance instead of rendering a second dialog that would fight the
 * first over focus.
 */

const TILE =
  "group flex items-center gap-2.5 rounded-xl border border-border dark:border-white/[0.07] bg-muted dark:bg-white/[0.03] px-3 py-2.5 " +
  "text-left transition-colors hover:border-border dark:hover:border-white/15 hover:bg-accent dark:hover:bg-white/[0.07]"

const LABEL = "min-w-0 truncate text-xs font-semibold text-foreground dark:text-zinc-200"

function Glyph({ icon: Icon, tint }: { icon: LucideIcon; tint: string }) {
  return (
    <span
      className={`flex size-7 shrink-0 items-center justify-center rounded-lg ${tint}`}
    >
      <Icon className="size-3.5" />
    </span>
  )
}

export function QuickActions() {
  const { getActions } = useCommandPalette()

  /*
    Read at click time, never at render. The registry is a ref that fills
    during the effects of the surrounding shell, so capturing it during render
    would reliably capture it empty on the first paint.
  */
  const run = (id: CommandActionId) => getActions().get(id)?.()

  return (
    <div className="grid grid-cols-2 gap-2">
      <button type="button" onClick={() => run("add-feed")} className={TILE}>
        <Glyph icon={Plus} tint="bg-blue-500/15 text-blue-700 dark:text-blue-300" />
        <span className={LABEL}>Add a feed</span>
      </button>

      <Link to="/discover" className={TILE}>
        <Glyph icon={Telescope} tint="bg-violet-500/15 text-violet-700 dark:text-violet-300" />
        <span className={LABEL}>Discover sources</span>
      </Link>

      <Link to="/dashboard/ai" className={TILE}>
        <Glyph icon={Sparkles} tint="bg-amber-500/15 text-amber-700 dark:text-amber-300" />
        <span className={LABEL}>Ask Spark AI</span>
      </Link>

      <button type="button" onClick={() => run("new-folder")} className={TILE}>
        <Glyph icon={FolderPlus} tint="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" />
        <span className={LABEL}>New folder</span>
      </button>
    </div>
  )
}
