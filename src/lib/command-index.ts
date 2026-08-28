/**
 * The command palette's pure half: what it can jump to, and how a query ranks.
 *
 * Kept free of React and of server imports so the ranking rules can be tested
 * directly — they are the part most likely to be wrong in a way that is hard
 * to see by eye.
 */

import { NAV_PAGES } from "@/config/nav-pages"

/** Non-navigating commands. Handlers are registered by whoever owns them. */
export type CommandActionId =
  | "add-feed"
  | "bulk-add-feeds"
  | "refresh-all"
  | "new-folder"
  | "toggle-sidebar"

export type PaletteItem = {
  /** Unique across the whole palette, and never the label — see below. */
  id: string
  label: string
  /** Muted trailing context: the parent folder, the section. */
  sublabel?: string
  /** What the query is scored against. `keywords[0]` is treated as the name. */
  keywords: Array<string>
} & (
  | { kind: "nav"; to: string }
  | { kind: "action"; actionId: CommandActionId }
  /** A folder: navigable, and also drillable into its feeds. */
  | { kind: "folder"; to: string; folderId: string }
)

/** A drill-down context: the pill shown left of the input. */
export type Scope =
  | { kind: "folder"; id: string; label: string }
  | { kind: "fixed"; id: FixedScopeId; label: string }

export type FixedScopeId = "pages" | "discover" | "actions"

export const FIXED_SCOPES: Array<{ id: FixedScopeId; label: string }> = [
  { id: "pages", label: "Pages" },
  { id: "discover", label: "Discover" },
  { id: "actions", label: "Actions" },
]

/**
 * How many rows a group shows when nothing is scoped.
 *
 * Sized to hold the whole of `NAV_PAGES`, and it has to be raised whenever that
 * list grows. Below it, the last page silently falls off an empty query and the
 * palette opens claiming to list the app's pages while hiding one of them. It
 * has been missed twice now — once when the old landing page split into Home
 * and All articles, once when Sources was added — so if you are here adding a
 * page, this is the line.
 */
export const UNSCOPED_GROUP_LIMIT = NAV_PAGES.length

/**
 * Substring-per-token, so "goog deep" finds "Google DeepMind".
 *
 * Returns 0 for no match. Anything above ranks: a name that starts with the
 * query beats one that merely contains it, which beats a match that only holds
 * once you consider the sublabel.
 */
export function scoreItem(query: string, keywords: Array<string>): number {
  const q = query.trim().toLowerCase()
  if (!q) return 1

  const haystack = keywords.join(" ").toLowerCase()
  const tokens = q.split(/\s+/)
  if (!tokens.every((token) => haystack.includes(token))) return 0

  const name = (keywords[0] ?? "").toLowerCase()
  if (name.startsWith(q)) return 1
  if (name.includes(q)) return 0.8
  return 0.6
}

export function rank<T extends { keywords: Array<string> }>(
  items: Array<T>,
  query: string,
  limit?: number,
): Array<T> {
  const scored = items
    .map((item) => ({ item, score: scoreItem(query, item.keywords) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item)

  return limit === undefined ? scored : scored.slice(0, limit)
}

/**
 * Reads a `Folder > rest` drill out of the raw query.
 *
 * Only commits when the text before the separator resolves to exactly one
 * target. Two reasons: a half-typed "te" would otherwise jump into whichever
 * folder happened to sort first, and a folder genuinely named "A > B" stays
 * findable by typing its full name, because "A" alone matching several things
 * (or nothing) leaves the query untouched.
 *
 * Splits on the FIRST separator, so drilling twice is not a thing — one level
 * is all the hierarchy this app has.
 */
export function parseDrill(
  query: string,
  folders: Array<{ id: string; name: string }>,
): { scope: Scope; rest: string } | null {
  const at = query.indexOf(">")
  if (at === -1) return null

  const head = query.slice(0, at).trim().toLowerCase()
  const rest = query.slice(at + 1).replace(/^\s+/, "")
  if (!head) return null

  const fixed = FIXED_SCOPES.filter((s) => s.label.toLowerCase() === head)
  if (fixed.length === 1) {
    return { scope: { kind: "fixed", id: fixed[0].id, label: fixed[0].label }, rest }
  }

  const exact = folders.filter((f) => f.name.toLowerCase() === head)
  const matches = exact.length > 0 ? exact : folders.filter((f) => f.name.toLowerCase().startsWith(head))
  if (matches.length !== 1) return null

  return {
    scope: { kind: "folder", id: matches[0].id, label: matches[0].name },
    rest,
  }
}
