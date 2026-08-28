import { useEffect, useRef, useState } from "react"
import type { PreviewFeed } from "@/server/services/catalogue-preview"
import { getCataloguePreview } from "@/server/catalogue"

export type PreviewStatus = "idle" | "loading" | "ready" | "error"

/**
 * Loads the articles behind one catalogue card.
 *
 * Fetched here rather than in a route loader on purpose. The dialog would
 * otherwise have to preload every card on the page, and the category page would
 * block its first paint on up to a dozen feeds. Both surfaces instead paint
 * immediately and fill in.
 *
 * `enabled` is what makes that work: the dialog passes `open`, and the category
 * page passes "has this row been scrolled into view yet", so nothing is fetched
 * for a card nobody has looked at.
 */
export function useCataloguePreview(
  target: { kind: "collection" | "feed"; slug: string } | null,
  enabled = true,
) {
  const [feeds, setFeeds] = useState<Array<PreviewFeed>>([])
  const [status, setStatus] = useState<PreviewStatus>("idle")

  /**
   * Guards against an out-of-order response. Opening card A then card B quickly
   * can land A's articles after B's, which would show the wrong feed's contents
   * under the right feed's name — the same trap PreviewSheet documents.
   */
  const current = useRef<string | null>(null)

  useEffect(() => {
    if (!target || !enabled) {
      current.current = null
      setStatus("idle")
      setFeeds([])
      return
    }

    const key = `${target.kind}:${target.slug}`
    current.current = key
    setStatus("loading")
    setFeeds([])

    getCataloguePreview({ data: { kind: target.kind, slug: target.slug } })
      .then((res) => {
        if (current.current !== key) return
        setFeeds(res.feeds)
        setStatus("ready")
      })
      .catch(() => {
        if (current.current !== key) return
        setStatus("error")
      })
  }, [target?.kind, target?.slug, enabled])

  return { feeds, status }
}
