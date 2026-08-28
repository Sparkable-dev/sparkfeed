import { Search } from "lucide-react"
import { CandidateRow } from "./CandidateRow"
import { NoFeedFound } from "./NoFeedFound"
import type { FeedCandidate } from "@/server/rss"
import type { FeedError } from "@/server/utils/feed-errors"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Spinner } from "@/components/ui/spinner"

/**
 * One address in, every feed that address leads to out.
 *
 * Two passes, which is why `phase` has four values rather than a boolean: the
 * fast pass resolves the typed URL and shows the site's main feed within a
 * couple of seconds, then the deep pass looks for section feeds and appends
 * them. Making the user wait on the second to see the first was the original
 * complaint about this dialog.
 */

export type SitePhase = "idle" | "checking" | "discovering" | "done"

export function SiteTab({
  url,
  onUrlChange,
  phase,
  candidates,
  error,
  siteName,
  isSelected,
  onToggle,
  onToggleAll,
  onCheck,
  onWatchPage,
}: {
  url: string
  onUrlChange: (next: string) => void
  phase: SitePhase
  candidates: Array<FeedCandidate>
  error: FeedError | null
  siteName: string
  isSelected: (candidate: FeedCandidate) => boolean
  onToggle: (candidate: FeedCandidate, next: boolean) => void
  onToggleAll: (next: boolean) => void
  onCheck: (url: string) => void
  onWatchPage: (() => void) | null
}) {
  const busy = phase === "checking" || phase === "discovering"
  const selectable = candidates.filter((c) => !c.alreadyAdded)
  const selectedCount = selectable.filter(isSelected).length
  const allSelected = selectable.length > 0 && selectedCount === selectable.length

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-zinc-600" />
          <Input
            id="add-feed-url"
            autoFocus
            value={url}
            placeholder="blog.example.com"
            aria-label="Site or feed address"
            onChange={(e) => onUrlChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && url.trim()) onCheck(url)
            }}
            className="h-9 w-full rounded-lg border-zinc-700/60 bg-zinc-900/40 pl-8 text-sm"
          />
        </div>
        <Button
          id="add-feed-check-btn"
          size="sm"
          variant="outline"
          disabled={busy || !url.trim()}
          onClick={() => onCheck(url)}
          className="h-9 shrink-0 border-white/10 bg-transparent text-xs text-zinc-200 hover:bg-white/10"
        >
          {phase === "checking" ? <Spinner className="size-3.5" /> : "Find"}
        </Button>
      </div>

      {phase === "idle" && !error && (
        <p className="text-xs text-zinc-600">
          A site, a blog, or a feed address — we will find the rest.
        </p>
      )}

      {error && (
        <p className="text-xs text-amber-400/90">{error.message}</p>
      )}

      {phase === "done" && candidates.length === 0 && !error && (
        <NoFeedFound url={url} onTry={onCheck} onWatchPage={onWatchPage} busy={busy} />
      )}

      {candidates.length > 0 && (
        <div className="flex min-w-0 flex-col">
          {/*
            The header checkbox is the select-all. The old dialog spent a whole
            strip on "5 found · All · None" beside a count; this is the same
            three controls in one.
          */}
          <label className="flex cursor-pointer items-center gap-3 border-b border-white/[0.06] px-2 pb-2">
            <Checkbox
              checked={allSelected}
              indeterminate={selectedCount > 0 && !allSelected}
              disabled={selectable.length === 0}
              onCheckedChange={onToggleAll}
              aria-label="Select every feed"
            />
            <span className="min-w-0 truncate text-xs text-zinc-400">
              {/*
                Pages and feeds are counted with different words because they
                are different offers: one is a feed the site publishes, the
                other is a page we would read on your behalf.
              */}
              {candidates.every((c) => c.kind === "page") ? (
                <>
                  No feed on <span className="text-zinc-300">{siteName || "that site"}</span>, but
                  we can read {candidates.length === 1 ? "this page" : "these pages"}
                </>
              ) : (
                <>
                  {candidates.length} {candidates.length === 1 ? "feed" : "feeds"} on{" "}
                  <span className="text-zinc-300">{siteName}</span>
                </>
              )}
            </span>
            {phase === "discovering" && (
              <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px] text-zinc-600">
                <Spinner className="size-3" />
                looking for more
              </span>
            )}
          </label>

          <div className="flex flex-col pt-1">
            {candidates.map((candidate) => (
              <CandidateRow
                key={candidate.url}
                candidate={candidate}
                checked={isSelected(candidate)}
                onCheckedChange={(next) => onToggle(candidate, next)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
