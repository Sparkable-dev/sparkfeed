import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { BulkTab } from "./BulkTab"
import { DestinationField } from "./DestinationField"
import { SiteTab } from "./SiteTab"
import type { BulkPhase } from "./BulkTab"
import type { SitePhase } from "./SiteTab"
import type { AddFeedOptions, AddFeedTab, FolderOption } from "./add-feed-context"
import type { BatchFeedResult, FeedCandidate } from "@/server/rss"
import type { FeedError } from "@/server/utils/feed-errors"
import type { Destination } from "@/server/services/feed-write"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { createFeeds, discoverFeeds, findPages, previewFeed, resolveFeedBatch } from "@/server/rss"
import { shouldAutoSelect } from "@/server/utils/feed-signals"
import { MAX_BATCH_URLS, chunk, parseBulkInput } from "@/lib/bulk-urls"
import { feedUrlKey } from "@/lib/validation"
import { DEMO_MODE } from "@/lib/demo"

/**
 * Add sources: one site, or a pasted list, into one destination.
 *
 * Selection is shared across both tabs on purpose. It means "paste a site, then
 * paste a list, then put all of it in one new folder" works, and it means the
 * footer count is the truth rather than the truth-for-this-tab.
 *
 * Nothing here is mounted per page. See `add-feed-context.tsx` for why there is
 * exactly one of these.
 */

/** A ticked source, keyed so two URLs for the same one cannot both be added. */
type Picked = { url: string; name: string; kind: "rss" | "page" }

function candidateName(candidate: FeedCandidate): string {
  const title = candidate.title?.trim()
  if (title) return title
  try {
    return new URL(candidate.url).hostname.replace(/^www\./, "")
  } catch {
    return candidate.url
  }
}

export function AddFeedDialog({
  open,
  onOpenChange,
  options,
  folders,
  onAdded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  options: AddFeedOptions
  folders: Array<FolderOption>
  onAdded: () => void
}) {
  const [tab, setTab] = useState<AddFeedTab>("site")
  const [destination, setDestination] = useState<Destination>({ kind: "none" })
  const [selected, setSelected] = useState<Map<string, Picked>>(new Map())
  const [submitting, setSubmitting] = useState(false)

  const [url, setUrl] = useState("")
  const [sitePhase, setSitePhase] = useState<SitePhase>("idle")
  const [candidates, setCandidates] = useState<Array<FeedCandidate>>([])
  const [siteError, setSiteError] = useState<FeedError | null>(null)
  const [siteName, setSiteName] = useState("")

  const [bulkText, setBulkText] = useState("")
  const [bulkPhase, setBulkPhase] = useState<BulkPhase>("idle")
  const [bulkResults, setBulkResults] = useState<Array<BatchFeedResult>>([])
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 })

  /*
    Reset on the opening edge only. The dialog is mounted permanently — it has
    to be, to be reachable from everywhere — so it cannot rely on a fresh mount
    to clear itself, and resetting on every render of `options` would wipe what
    the user is typing.
  */
  useEffect(() => {
    if (!open) return
    setTab(options.tab ?? "site")
    setDestination(
      options.folderId ? { kind: "existing", folderId: options.folderId } : { kind: "none" },
    )
    setSelected(new Map())
    setSubmitting(false)
    setUrl(options.url ?? "")
    setSitePhase("idle")
    setCandidates([])
    setSiteError(null)
    setSiteName("")
    setBulkText("")
    setBulkPhase("idle")
    setBulkResults([])
    setBulkProgress({ done: 0, total: 0 })
    // Deliberately depends on `open` alone. `options` is a fresh object on
    // every render, so including it would re-run this on each keystroke and
    // wipe what the user is typing.
  }, [open])

  const isSelected = useCallback(
    (candidate: FeedCandidate) => selected.has(feedUrlKey(candidate.url)),
    [selected],
  )

  const setPicked = useCallback((items: Array<FeedCandidate>, next: boolean) => {
    setSelected((prev) => {
      const map = new Map(prev)
      for (const candidate of items) {
        if (candidate.alreadyAdded) continue
        const key = feedUrlKey(candidate.url)
        if (next) {
          map.set(key, {
            url: candidate.url,
            name: candidateName(candidate),
            kind: candidate.kind === "page" ? "page" : "rss",
          })
        }
        else map.delete(key)
      }
      return map
    })
  }, [])

  /** Ticks the ones worth ticking, leaving comments feeds and empties alone. */
  const autoSelect = useCallback(
    (items: Array<FeedCandidate>) => {
      setPicked(
        items.filter((c) => shouldAutoSelect(c.signals, c.alreadyAdded)),
        true,
      )
    },
    [setPicked],
  )

  // ── Site tab ────────────────────────────────────────────────────────────

  const runCheck = useCallback(
    async (raw: string) => {
      const target = raw.trim()
      if (!target) return

      setUrl(target)
      setSitePhase("checking")
      setSiteError(null)
      setCandidates([])

      let preview
      try {
        preview = await previewFeed({ data: { url: target } })
      } catch {
        setSitePhase("done")
        setSiteError({ code: "invalid_url", message: "That does not look like a web address." })
        return
      }

      if (preview.status === "error") {
        setSitePhase("done")
        setSiteError(preview.error)
        return
      }

      setSiteName(preview.siteName)
      setCandidates(preview.feeds)
      autoSelect(preview.feeds)

      // The deep pass. Its failures are swallowed: the main feed is already on
      // screen and usable, and an error banner about section feeds would be
      // reporting a problem the user does not have.
      setSitePhase("discovering")

      /*
        No feed anywhere on the site. Ask where its writing lives instead —
        someone pasting `emerline.com` wants `emerline.com/blog`, and the site's
        own sitemap says so. Only when the feed search came back empty: a real
        feed always beats parsing HTML, so this is the fallback, never a
        supplement.
      */
      if (preview.feeds.length === 0) {
        try {
          const pages = await findPages({ data: { url: target } })
          if (pages.status === "ok" && pages.pages.length > 0) {
            setCandidates(pages.pages)
            // Deliberately not auto-ticked. Reading a page is a different
            // proposition from subscribing to a feed, and it should be a choice
            // rather than something that happened while you were looking away.
          }
        } catch {
          /* nothing to add; the empty state below still explains itself */
        }
        setSitePhase("done")
        return
      }

      try {
        const more = await discoverFeeds({
          data: {
            origin: preview.origin,
            anchorUrl: preview.feeds[0]?.url ?? null,
            known: preview.feeds.map((f) => f.identity),
          },
        })
        if (more.status === "ok" && more.feeds.length > 0) {
          setCandidates((prev) => {
            const seen = new Set(prev.map((f) => f.identity))
            return [...prev, ...more.feeds.filter((f) => !seen.has(f.identity))]
          })
          autoSelect(more.feeds)
        }
      } catch {
        /* the fast pass already gave the user something to act on */
      } finally {
        setSitePhase("done")
      }
    },
    [autoSelect],
  )

  // ── Bulk tab ────────────────────────────────────────────────────────────

  const runBulkCheck = useCallback(async () => {
    const { urls } = parseBulkInput(bulkText)
    if (urls.length === 0) return

    setBulkPhase("checking")
    setBulkResults([])
    setBulkProgress({ done: 0, total: urls.length })

    /*
      A few at a time, in sequence. Forty addresses in one request would sit
      well past any sensible timeout; this keeps each round trip short and the
      list fills in as the user watches.
    */
    for (const batch of chunk(urls, MAX_BATCH_URLS)) {
      try {
        const result = await resolveFeedBatch({ data: { urls: batch } })
        if (result.status === "ok") {
          setBulkResults((prev) => [...prev, ...result.results])
          autoSelect(result.results.map((r) => r.feed).filter((f): f is FeedCandidate => !!f))
        } else {
          toast.error(result.error.message)
          break
        }
      } catch {
        toast.error("Could not check those addresses.")
        break
      } finally {
        setBulkProgress((prev) => ({ ...prev, done: prev.done + batch.length }))
      }
    }

    setBulkPhase("done")
  }, [bulkText, autoSelect])

  // ── Submit ──────────────────────────────────────────────────────────────

  const picks = useMemo(() => [...selected.values()], [selected])

  const destinationReady =
    destination.kind !== "new" || destination.name.trim().length > 0

  const handleAdd = async () => {
    if (picks.length === 0 || !destinationReady) return
    setSubmitting(true)
    try {
      const result = await createFeeds({ data: { feeds: picks, destination } })
      if (result.status === "error") {
        toast.error(result.error.message)
        return
      }

      if (result.added.length > 0) {
        toast.success(
          result.added.length === 1
            ? `Added ${result.added[0].name}`
            : `Adding ${result.added.length} sources`,
          { description: "Articles are loading in the background." },
        )
      }
      if (result.skipped.length > 0 && result.added.length === 0) {
        toast.info("You already have all of those.")
      }
      if (result.failed.length > 0) {
        toast.warning(
          `${result.failed.length} could not be added`,
          { description: result.failed.map((f) => f.name).join(", ") },
        )
      }

      onAdded()
      onOpenChange(false)
    } catch {
      toast.error("Could not add those feeds.")
    } finally {
      setSubmitting(false)
    }
  }

  /**
   * The scraper slot.
   *
   * Null on purpose, which hides it. A watched page becomes a source no part of
   * the app currently renders, so offering the button is offering a dead end —
   * it was the only thing the old "no feed found" panel had to say. The next
   * phase supplies a handler here and nothing else in this dialog changes.
   */
  const watchPage: (() => void) | null = null

  const busy = submitting || sitePhase === "checking" || bulkPhase === "checking"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className="flex max-h-[85vh] flex-col gap-0 border-border dark:border-white/10 bg-card dark:bg-[#141414] p-0 text-foreground dark:text-white sm:max-w-lg"
      >
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle className="text-base font-semibold">Add sources</DialogTitle>
        </DialogHeader>

        {DEMO_MODE && (
          <p className="mx-5 mb-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            Adding sources is locked in demo mode.
          </p>
        )}

        <Tabs
          value={tab}
          onValueChange={(next) => setTab(next as AddFeedTab)}
          className="min-h-0 flex-1 gap-0"
        >
          <TabsList variant="line" className="mx-5 shrink-0 justify-start">
            <TabsTrigger value="site" className="px-1 text-sm">
              Website
            </TabsTrigger>
            <TabsTrigger value="bulk" className="px-1 text-sm">
              Paste a list
            </TabsTrigger>
          </TabsList>

          {/*
            The scroll container. Without a cap here the bulk tab's results push
            the destination row and the footer off the bottom of the viewport,
            which is exactly when you need them.
          */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-1">
            <TabsContent value="site">
              <SiteTab
                url={url}
                onUrlChange={setUrl}
                phase={sitePhase}
                candidates={candidates}
                error={siteError}
                siteName={siteName}
                isSelected={isSelected}
                onToggle={(candidate, next) => setPicked([candidate], next)}
                onToggleAll={(next) => setPicked(candidates, next)}
                onCheck={(next) => void runCheck(next)}
                onWatchPage={watchPage}
              />
            </TabsContent>

            <TabsContent value="bulk">
              <BulkTab
                text={bulkText}
                onTextChange={setBulkText}
                phase={bulkPhase}
                done={bulkProgress.done}
                total={bulkProgress.total}
                results={bulkResults}
                isSelected={isSelected}
                onToggle={(candidate, next) => setPicked([candidate], next)}
                onToggleAll={(next) =>
                  setPicked(
                    bulkResults.map((r) => r.feed).filter((f): f is FeedCandidate => !!f),
                    next,
                  )
                }
                onCheck={() => void runBulkCheck()}
              />
            </TabsContent>
          </div>
        </Tabs>

        <div className="shrink-0 border-t border-border dark:border-white/[0.07] px-5 py-3">
          <DestinationField
            value={destination}
            onChange={setDestination}
            folders={folders}
            disabled={submitting}
            suggestion={siteName}
          />
        </div>

        <DialogFooter className="shrink-0 border-t border-border dark:border-white/[0.07] px-5 py-3">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="text-sm text-muted-foreground dark:text-zinc-400 hover:text-foreground dark:hover:text-white"
          >
            Cancel
          </Button>
          <Button
            id="add-feed-save-btn"
            disabled={busy || picks.length === 0 || !destinationReady || DEMO_MODE}
            onClick={() => void handleAdd()}
            className="gap-1.5 bg-primary dark:bg-white text-sm font-semibold text-primary-foreground dark:text-black hover:bg-primary/90 dark:hover:bg-zinc-200"
          >
            {submitting && <Spinner className="size-3.5" />}
            {/*
              "sources" once a watched page is in the mix, because calling one a
              feed is the thing this whole flow is careful not to do.
            */}
            {picks.length === 0
              ? "Add"
              : `Add ${picks.length} ${
                  picks.some((p) => p.kind === "page")
                    ? picks.length === 1
                      ? "source"
                      : "sources"
                    : picks.length === 1
                      ? "feed"
                      : "feeds"
                }`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
