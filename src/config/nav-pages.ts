/**
 * The app's primary destinations, in sidebar order.
 *
 * Shared so the sidebar and the command palette cannot disagree about what
 * exists. The sidebar attaches an icon and a live count to each entry; the
 * palette needs neither, and duplicating the list is how one of them ends up
 * offering a page the other has retired.
 */
export type NavPageKey =
  | "home"
  | "all"
  | "today"
  | "favorites"
  | "discover"
  | "ai"
  | "sources"

/*
  Grouped by what a row is for: the first four are places to read, then a place
  to find, then the shelf itself, and Spark AI last. An earlier order
  interleaved them, and the first entry was called "Explore" while the page
  below it was called "Discover" — two words for the same idea, one of which
  meant the opposite.

  Spark AI sits at the end because it is the only row that grows: the chat
  history hangs beneath it, and a scrolling list wedged into the middle of the
  navigation pushes everything under it to an address that keeps moving.
*/
export const NAV_PAGES: Array<{
  key: NavPageKey
  title: string
  href: string
  /** Highlight only on an exact path match, not on descendants. */
  exact?: boolean
}> = [
  { key: "home", title: "Home", href: "/", exact: true },
  { key: "all", title: "All articles", href: "/all", exact: true },
  { key: "today", title: "Today", href: "/today", exact: true },
  { key: "favorites", title: "Favorites", href: "/favorites", exact: true },
  { key: "discover", title: "Discover", href: "/discover", exact: true },
  // Management rather than reading, so it sits after everything you might open
  // to actually read something.
  { key: "sources", title: "Sources", href: "/sources", exact: true },
  { key: "ai", title: "Spark AI", href: "/dashboard/ai" },
]

/**
 * Reachable pages that are not sidebar rows — they live in menus, so without
 * this the palette could not offer them at all.
 */
export const SECONDARY_PAGES: Array<{ title: string; href: string; section: string }> = [
  { title: "Settings", href: "/settings", section: "Account" },
  { title: "API keys", href: "/developer/keys", section: "Developer" },
  { title: "MCP", href: "/developer/mcp", section: "Developer" },
]
