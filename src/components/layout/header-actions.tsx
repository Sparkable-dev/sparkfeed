import { Plus, RefreshCw } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { timeAgo } from "@/lib/time-ago"

/** One step of the breadcrumb. The last entry is the current page. */
export type Crumb = {
  label: string
  /** Omit on the leaf, and on ancestors that are not their own page. */
  href?: string
}

/**
 * A right-slot control, described rather than rendered.
 *
 * The top bar has to exist twice — a desktop row and a mobile row — and the
 * two are not the same shape: desktop can afford a labelled button, mobile
 * gets an icon or an overflow entry. Every previous attempt at this let each
 * page write both, and they drifted. The Manage / Share / Rename / Delete menu
 * is the proof: it was written into the mobile branch and never into the
 * desktop one, so on a wide screen it simply did not exist.
 *
 * So pages describe the action once and `AppTopBar` derives both renderings.
 * There is no way to describe a desktop control and forget its mobile twin,
 * because neither is what you are describing.
 */
export type HeaderAction =
  | {
      kind: "button"
      /** Also used as the DOM id, so browser automation keeps its handles. */
      id: string
      icon: LucideIcon
      label: string
      onClick: () => void
      variant?: "primary" | "ghost"
      disabled?: boolean
      /** Spins the icon and blocks the click. */
      busy?: boolean
    }
  | {
      kind: "search"
      id: string
      value: string
      onChange: (value: string) => void
      placeholder?: string
    }
  /** Quiet status text, e.g. "Updated 4m ago". Never collapses to an icon. */
  | { kind: "note"; id: string; text: string }
  /**
   * An escape hatch for controls that are already components — a dropdown, an
   * avatar. It is opaque to the collapsing logic, so it renders as-is at both
   * sizes and belongs to things that are small at both sizes.
   */
  | { kind: "custom"; id: string; node: React.ReactNode }

// ─────────────────────────────────────────────
// Builders for the actions that repeat across pages
// ─────────────────────────────────────────────

export function refreshAction(onClick: () => void, busy: boolean): HeaderAction {
  return {
    kind: "button",
    id: "refresh-btn",
    icon: RefreshCw,
    label: "Refresh all feeds",
    onClick,
    variant: "ghost",
    busy,
  }
}

export function addFeedAction(onClick: () => void): HeaderAction {
  return {
    kind: "button",
    id: "add-feed-btn",
    icon: Plus,
    label: "Add Feed",
    onClick,
    variant: "primary",
  }
}

export function searchAction(
  value: string,
  onChange: (v: string) => void,
): HeaderAction {
  return {
    kind: "search",
    id: "article-search",
    value,
    onChange,
    placeholder: "Search articles…",
  }
}

/**
 * "Updated 4m ago", from the most recent successful fetch in view.
 *
 * Newest rather than oldest: this sits beside the refresh button, so it is
 * read as "when did that last run". Oldest would be the more conservative
 * number but it reports a workspace as stale whenever a single dead feed is
 * in it, which is both alarming and unactionable from here — per-feed
 * freshness already lives in the manage dialog.
 *
 * Returns null when nothing has ever fetched, so the caller can omit it
 * entirely rather than print "Never".
 */
export function lastUpdatedNote(
  feeds: Array<{ lastFetchedAt?: string | null }>,
): HeaderAction | null {
  let newest: number | null = null
  for (const feed of feeds) {
    if (!feed.lastFetchedAt) continue
    const at = new Date(feed.lastFetchedAt).getTime()
    if (Number.isNaN(at)) continue
    if (newest === null || at > newest) newest = at
  }
  if (newest === null) return null

  return {
    kind: "note",
    id: "last-updated",
    text: `Updated ${timeAgo(new Date(newest).toISOString())}`,
  }
}
