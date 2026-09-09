import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import type { FeedRow } from "@/lib/rss-types"
import { feedNeedsRefresh } from "@/lib/feed-freshness"
import {
  refreshAllFeeds,
  refreshFeed,
  refreshFolder,
  refreshStaleFeeds,
} from "@/server/rss"

export function useFeedRefresh({
  feeds,
  enabled,
  folderId,
  feedId,
  onRefreshed,
}: {
  feeds: Array<FeedRow>
  enabled: boolean
  folderId?: string
  feedId?: string
  onRefreshed: () => Promise<void>
}) {
  const [refreshing, setRefreshing] = useState(false)
  const running = useRef(false)
  const attempted = useRef(new Set<string>())
  const workspaceId = feeds[0]?.workspaceId

  const refresh = useCallback(
    async (automatic = false) => {
      if (!enabled || running.current || (automatic && !workspaceId)) return
      running.current = true
      setRefreshing(true)
      try {
        const result = automatic
          ? await refreshStaleFeeds({ data: { workspaceId: workspaceId! } })
          : feedId
            ? await refreshFeed({ data: { feedId } })
            : folderId
              ? await refreshFolder({ data: { folderId } })
              : await refreshAllFeeds()
        await onRefreshed()
        const failed = "failed" in result ? result.failed : result.ok ? 0 : 1
        if (failed > 0) {
          toast.warning(
            `${failed} ${failed === 1 ? "source could" : "sources could"} not fully refresh. Check Sources for details.`
          )
        }
      } catch {
        toast.error(
          "Could not refresh your feeds. Your saved articles are still available. Try again."
        )
      } finally {
        running.current = false
        setRefreshing(false)
      }
    },
    [enabled, workspaceId, feedId, folderId, onRefreshed]
  )

  useEffect(() => {
    if (
      !enabled ||
      !workspaceId ||
      running.current ||
      attempted.current.has(workspaceId)
    )
      return
    attempted.current.add(workspaceId)
    if (feeds.some((feed) => feedNeedsRefresh(feed))) void refresh(true)
  }, [enabled, workspaceId, feeds, refresh, refreshing])

  return { refreshing, refresh: () => refresh(false) }
}
