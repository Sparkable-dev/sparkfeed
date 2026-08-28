import { CandidateRow } from "./CandidateRow"
import type { BatchFeedResult, FeedCandidate } from "@/server/rss"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Spinner } from "@/components/ui/spinner"
import { MAX_BULK_URLS, parseBulkInput } from "@/lib/bulk-urls"

/**
 * A pasted list, checked a few at a time.
 *
 * The check is chunked by the caller and results appear as they land, so
 * pasting thirty addresses shows a list filling in rather than a spinner. That
 * is the whole reason there is a progress line here and not just a button.
 *
 * Rows that failed stay on screen. A silent list of nine successes out of
 * twelve is worse than saying which three did not resolve — that is the
 * feedback that tells someone they pasted a homepage instead of a blog.
 */

export type BulkPhase = "idle" | "checking" | "done"

export function BulkTab({
  text,
  onTextChange,
  phase,
  done,
  total,
  results,
  isSelected,
  onToggle,
  onToggleAll,
  onCheck,
}: {
  text: string
  onTextChange: (next: string) => void
  phase: BulkPhase
  done: number
  total: number
  results: Array<BatchFeedResult>
  isSelected: (candidate: FeedCandidate) => boolean
  onToggle: (candidate: FeedCandidate, next: boolean) => void
  onToggleAll: (next: boolean) => void
  onCheck: () => void
}) {
  const parsed = parseBulkInput(text)
  const busy = phase === "checking"

  const found = results.filter((r) => r.feed).map((r) => r.feed!)
  const selectable = found.filter((c) => !c.alreadyAdded)
  const selectedCount = selectable.filter(isSelected).length
  const allSelected = selectable.length > 0 && selectedCount === selectable.length

  const failures = results.filter((r) => !r.feed)
  const alreadyAdded = found.filter((c) => c.alreadyAdded).length

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Textarea
        id="add-feed-bulk"
        autoFocus
        rows={4}
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        placeholder={"simonwillison.net\noverreacted.io\nhttps://danluu.com/atom.xml"}
        aria-label="Addresses, one per line"
        className="min-h-24 resize-y rounded-lg border-zinc-700/60 bg-zinc-900/40 text-xs"
      />

      <div className="flex min-w-0 items-center gap-2">
        <p className="min-w-0 flex-1 text-xs text-zinc-600">
          One per line. Bare sites work too — up to {MAX_BULK_URLS}.
          {parsed.overflow > 0 && (
            <span className="text-amber-400/90">
              {" "}
              {parsed.overflow} past the limit will be ignored.
            </span>
          )}
        </p>
        <Button
          id="add-feed-bulk-check-btn"
          size="sm"
          variant="outline"
          disabled={busy || parsed.urls.length === 0}
          onClick={onCheck}
          className="h-8 shrink-0 border-white/10 bg-transparent text-xs text-zinc-200 hover:bg-white/10"
        >
          {busy ? <Spinner className="size-3.5" /> : `Check ${parsed.urls.length || ""}`.trim()}
        </Button>
      </div>

      {busy && total > 0 && (
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-zinc-400 transition-[width] duration-300"
              style={{ width: `${(done / total) * 100}%` }}
            />
          </div>
          <p className="text-[11px] text-zinc-600 tabular-nums">
            checked {done} of {total}
          </p>
        </div>
      )}

      {results.length > 0 && (
        <div className="flex min-w-0 flex-col">
          <label className="flex cursor-pointer items-center gap-3 border-b border-white/[0.06] px-2 pb-2">
            <Checkbox
              checked={allSelected}
              indeterminate={selectedCount > 0 && !allSelected}
              disabled={selectable.length === 0}
              onCheckedChange={onToggleAll}
              aria-label="Select every feed"
            />
            <span className="min-w-0 truncate text-xs text-zinc-400">
              {selectable.length} ready
              {alreadyAdded > 0 && ` · ${alreadyAdded} already added`}
              {failures.length > 0 && ` · ${failures.length} not a feed`}
            </span>
          </label>

          <div className="flex flex-col pt-1">
            {found.map((candidate) => (
              <CandidateRow
                key={candidate.url}
                candidate={candidate}
                checked={isSelected(candidate)}
                onCheckedChange={(next) => onToggle(candidate, next)}
              />
            ))}

            {/*
              Failures keep their row rather than vanishing, so the count above
              and the list below agree and the user can see which line was the
              problem.
            */}
            {failures.map((failure) => (
              <div
                key={failure.input}
                className="flex min-w-0 items-start gap-3 px-2 py-2 opacity-70"
              >
                <span aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block min-w-0 truncate text-sm text-zinc-400">
                    {failure.input}
                  </span>
                  <span className="mt-0.5 block text-xs text-amber-400/80">
                    {failure.error?.message ?? "No feed found."}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
