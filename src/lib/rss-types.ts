export interface FeedRow {
  id: string
  name: string
  url: string
  folderId: string | null
  includeKeywords?: string | null
  excludeKeywords?: string | null
  /** From `feed_shares`. Undefined on any path that does not join that table. */
  isShared?: boolean
  hasPassword?: boolean
  /** Last successful fetch. Null for a feed that has never been read. */
  lastFetchedAt?: string | null
  lastErrorAt?: string | null
  entitlementPausedAt?: string | null
  workspaceId?: string | null
  /**
   * `rss`, or `page` for a site with no feed that we read from its listing.
   * Optional because several paths build a FeedRow without touching the column.
   */
  kind?: string | null
}

export interface FolderRow {
  id: string
  name: string
  isShared?: boolean
  hasPassword?: boolean
}
