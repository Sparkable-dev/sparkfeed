import { feedPath, metaParts } from "./signal-labels"
import type { FeedCandidate } from "@/server/rss"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"

/**
 * One feed, in two lines.
 *
 * The name, then a single muted line of facts. No chips, no per-row border, no
 * separate URL line — the first version of this dialog gave every fact its own
 * decoration and read as clutter. A problem is simply the first fact and
 * coloured; everything else is the same grey as the rest.
 *
 * The feed's path rides at the end of the meta line and disappears below `sm`.
 * On a desktop it is what separates two similarly named section feeds; on a
 * phone it is what makes the row wrap, and the tooltip still has the full URL.
 */
export function CandidateRow({
  candidate,
  checked,
  onCheckedChange,
}: {
  candidate: FeedCandidate
  checked: boolean
  onCheckedChange: (next: boolean) => void
}) {
  const disabled = candidate.alreadyAdded
  /*
    A listing page has no cadence and no dates — the meta line describes what we
    found on it instead, which is the only evidence that reading it will work.
  */
  const { parts, hidden } =
    candidate.kind === "page"
      ? {
          parts: candidate.alreadyAdded
            ? [{ key: "added", text: "Already added", tone: "muted" as const }]
            : [
                {
                  key: "posts",
                  text: `${candidate.itemCount} posts on this page`,
                  tone: "muted" as const,
                },
              ],
          hidden: [],
        }
      : metaParts(candidate.signals, candidate.alreadyAdded)
  const path = feedPath(candidate.url)
  const name = candidate.title?.trim() || path || candidate.url

  return (
    <label
      title={candidate.url}
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 transition-colors",
        disabled ? "cursor-default opacity-60" : "hover:bg-white/[0.04]",
      )}
    >
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        className="mt-0.5"
      />

      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-sm text-zinc-100">{name}</span>
          {/*
            The only marks that survived. Neither is decoration: on a site with
            six section feeds, "Main" says which one is the site's own, and
            "Page" says this is not a feed at all — we would be reading someone
            else's HTML, which is worth knowing before you subscribe.
          */}
          {candidate.kind === "primary" && (
            <span className="shrink-0 text-[10px] font-medium tracking-wide text-zinc-600 uppercase">
              Main
            </span>
          )}
          {candidate.kind === "page" && (
            <span
              title="This site has no feed. We would read its page and watch for new posts."
              className="shrink-0 rounded bg-amber-400/10 px-1 py-px text-[10px] font-medium tracking-wide text-amber-400/90 uppercase"
            >
              Page
            </span>
          )}
        </span>

        <span
          className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-zinc-500"
          title={hidden.length > 0 ? hidden.map((h) => h.text).join(" · ") : undefined}
        >
          {parts.map((part, i) => (
            <span key={part.key} className="flex items-center gap-1.5">
              {i > 0 && <span aria-hidden="true" className="text-zinc-700">·</span>}
              <span
                title={part.title}
                className={part.tone === "warn" ? "text-amber-400/90" : undefined}
              >
                {part.text}
              </span>
            </span>
          ))}

          {path && (
            <span className="hidden min-w-0 items-center gap-1.5 sm:flex">
              {parts.length > 0 && <span aria-hidden="true" className="text-zinc-700">·</span>}
              <span className="min-w-0 truncate text-zinc-600">{path}</span>
            </span>
          )}
        </span>
      </span>
    </label>
  )
}
