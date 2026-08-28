import * as React from "react"

export interface GuestShare {
  /** The shared entity's id, parsed out of the route slug. */
  entityId: string
  /** Full slug, so sign-in links can come back to exactly this page. */
  folderSlug: string
  kind: "folder" | "feed"
  /** Which feed the sidebar has selected, or null for "everything shared". */
  selectedFeedId: string | null
  selectFeed: (id: string | null) => void
  addToWorkspace: () => void
  adding: boolean
  added: boolean
}

const GuestShareContext = React.createContext<GuestShare | null>(null)

export function GuestShareProvider({
  value,
  children,
}: {
  value: GuestShare
  children: React.ReactNode
}) {
  return (
    <GuestShareContext.Provider value={value}>
      {children}
    </GuestShareContext.Provider>
  )
}

/**
 * Guest-mode descriptor, or null when the caller is not inside a share page.
 *
 * Context rather than a prop threaded down from `RSSShell`, because the tree
 * forks: the sidebar chain is RSSShell → AppSidebar → NavFolders, but the
 * article chain is RSSShell → ArticleGrid → ArticleCard → PreviewSheet, and
 * ArticleGrid is rendered from half a dozen other routes. Threading a flag that
 * is false at every one of those call sites would mean editing the busiest
 * components in the app to serve a single page.
 *
 * A module constant in the shape of `DEMO_MODE` cannot express this either:
 * demo mode is one value for a whole deployment, whereas on the same deployment
 * `/` is authenticated and `/sprk/x` is not — and a signed-in user on `/sprk/x`
 * is neither guest nor owner.
 *
 * Returns null instead of throwing, deliberately. `AppSidebar` renders on every
 * route and must not explode off the share page.
 */
export function useGuestShare(): GuestShare | null {
  return React.useContext(GuestShareContext)
}
