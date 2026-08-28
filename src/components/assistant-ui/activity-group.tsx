import * as React from "react"
import { ChevronRightIcon, SparklesIcon } from "lucide-react"
import type { ToolCallMessagePartProps } from "@assistant-ui/react"
import { cn } from "@/lib/utils"

/**
 * Everything the model did before it answered, as one thing.
 *
 * The thread used to render a turn as a stack of separate `Reasoning ›` and
 * `1 tool call ›` disclosures — one pair per step, because the grouper
 * coalesces only *adjacent* parts sharing a path, and a run alternates between
 * the two. Four steps meant eight boxes above the answer, and the answer itself
 * was pushed off the screen.
 *
 * What comes in here is everything the model did on the way to an answer:
 * reasoning, and every lookup it ran. What stays out is the answer itself and
 * the few cards that *are* answers — an article, a feed to subscribe to, a
 * chart. `thread.tsx` owns that split and explains it.
 *
 * While the model works this is a live rail, so you can watch it think. When the
 * answer starts it folds into one line, because by then the thinking is history
 * and the answer is the point.
 */

interface ActivityGroupProps {
  running: boolean
  steps: number
  /**
   * How long the whole turn took, when the runtime reported it.
   *
   * Passed in rather than read here. `useMessageTiming` needs an `AuiProvider`
   * above it, and reaching for it inside this component would mean the rail
   * could only ever be rendered inside a live chat — no test, no preview, and a
   * crash in any future place that wants to show one.
   */
  elapsedMs?: number | undefined
  children: React.ReactNode
}

export function ActivityGroup({
  running,
  steps,
  elapsedMs,
  children,
}: ActivityGroupProps) {
  // `undefined` until the reader touches it; after that their choice sticks,
  // exactly as the reasoning disclosure behaves. Without this, a group the
  // reader opened would slam shut the moment the run finished.
  const [userOpen, setUserOpen] = React.useState<boolean | undefined>(undefined)
  const open = userOpen ?? running
  const summary = activitySummary(running, steps, elapsedMs)

  return (
    <div className="mt-1 mb-3">
      <button
        type="button"
        onClick={() => setUserOpen(!open)}
        aria-expanded={open}
        className="group/activity flex items-center gap-1.5 rounded-md py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <SparklesIcon
          className={cn("size-3.5 shrink-0", running && "animate-pulse")}
        />
        <span>{summary}</span>
        <ChevronRightIcon
          className={cn(
            "size-3.5 shrink-0 transition-transform",
            open && "rotate-90"
          )}
        />
      </button>

      {open ? (
        // The rail. `space-y-0` and per-node padding rather than a gap, so the
        // border reads as one unbroken line rather than a dashed one.
        <div className="mt-1 ms-[7px] border-s border-border ps-4">
          {children}
        </div>
      ) : null}
    </div>
  )
}

/**
 * "Worked for 8s · 3 steps".
 *
 * The duration is optional because the runtime does not always report one. A
 * missing timing drops the phrase rather than printing "Worked for 0s", which
 * would read as a bug in the model rather than a gap in the telemetry.
 */
function activitySummary(
  running: boolean,
  steps: number,
  ms: number | undefined
): string {
  const stepLabel = `${steps} ${steps === 1 ? "step" : "steps"}`

  if (running) return "Working…"
  if (!ms || ms < 100) return `Worked · ${stepLabel}`

  const seconds = ms / 1000
  const shown = seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)
  return `Worked for ${shown}s · ${stepLabel}`
}

/** One thought on the rail. */
export function ActivityThought({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative py-1.5 text-xs leading-relaxed text-muted-foreground">
      <Node />
      <div className="[&_.aui-md-p]:my-1 [&_.aui-md-p:first-child]:mt-0 [&_.aui-md-p:last-child]:mb-0">
        {children}
      </div>
    </div>
  )
}

/**
 * One tool call on the rail.
 *
 * A line by default, whether or not the tool has a card. Most calls on the rail
 * are lookups — list the feeds, search the articles, size up the workspace —
 * and their results are how the model reached its answer rather than the answer
 * itself. Printed in full they buried it; as a line each, the whole of a
 * four-step turn fits above the reply.
 *
 * When there *is* a card, the line opens onto it, so nothing is actually hidden
 * — checking where a number came from is one click, from the step that produced
 * it. Expanding is per-line rather than for the whole rail: opening one lookup
 * should not unfold four others.
 *
 * A tool that failed or is waiting on approval never reaches here; it is routed
 * to the transcript instead, because an error nobody can see and an approval
 * nobody can click are both worse than clutter. See `thread.tsx`.
 */
export function ActivityToolLine({
  toolName,
  args,
  result,
  status,
  children,
}: ToolCallMessagePartProps & { children?: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  // The result first: a line about reading an article should name the article,
  // and the argument that identifies that call is an opaque id.
  const detail = resultTitle(result) ?? tellingArgument(args)
  const running = status?.type === "running"

  const label = (
    <>
      <span className="font-medium text-foreground/80">
        {humanise(toolName)}
      </span>
      {detail ? (
        <span className="ms-1.5 text-muted-foreground">{detail}</span>
      ) : null}
      {running ? (
        <span className="ms-1.5 text-muted-foreground">· running…</span>
      ) : null}
    </>
  )

  if (!children) {
    return (
      <div className="relative py-1.5 text-xs">
        <Node running={running} />
        {label}
      </div>
    )
  }

  return (
    <div className="relative py-1.5 text-xs">
      <Node running={running} />
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="group/step flex items-center gap-1.5 text-start transition-colors hover:text-foreground"
      >
        {label}
        <ChevronRightIcon
          className={cn(
            "size-3 shrink-0 text-muted-foreground/60 transition-transform",
            open && "rotate-90"
          )}
        />
      </button>

      {open ? <div className="mt-1.5 mb-1">{children}</div> : null}
    </div>
  )
}

/** The dot on the rail, pulled out onto the border itself. */
function Node({ running }: { running?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute -start-[21px] top-2.5 size-[7px] rounded-full ring-2 ring-background",
        running ? "animate-pulse bg-primary" : "bg-border"
      )}
    />
  )
}

/**
 * What each step is called on the rail.
 *
 * Now that every lookup lands here, the rail is the only account of what the
 * model did, and `get_workspace_info` → "Get workspace info" is an API name with
 * the underscores taken out rather than a description of anything. These are
 * what a person would say they were doing.
 *
 * A tool with no entry falls back to its own name, tidied — so a tool added
 * later reads acceptably before anyone thinks to name it here.
 */
const TOOL_LABELS: Record<string, string> = {
  get_workspace_info: "Checked the workspace",
  list_folders: "Listed folders",
  list_feeds: "Listed feeds",
  search_articles: "Searched articles",
  get_article: "Read",
  read_url: "Read",
  web_search: "Searched the web",
  mark_read: "Marked as read",
  mark_favorite: "Favourited",
}

/** `find_feeds` → `Find feeds`. */
function humanise(name: string): string {
  const known = TOOL_LABELS[name]
  if (known) return known
  const words = name.replace(/_/g, " ")
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * The name of the thing a step produced, when it produced one thing.
 *
 * Only `title`, and only a plain string. A result is an arbitrary tool payload,
 * and reaching further into it for something label-shaped is how a rail ends up
 * printing an id, a URL fragment or half a sentence of body text.
 */
function resultTitle(result: unknown): string | null {
  if (!result || typeof result !== "object") return null
  const title = (result as { title?: unknown }).title
  return typeof title === "string" && title.trim() ? truncate(title) : null
}

/**
 * The one argument worth showing beside a tool name.
 *
 * Printing the whole args object turns the rail back into the wall of JSON it
 * replaced. These keys are the ones that answer "which one?" — and the fallback
 * takes the first short string rather than nothing, so a new tool still says
 * something useful before anyone thinks to add its key here.
 *
 * The id keys are deliberately absent. `art_9f2c…` answers "which one?" only to
 * the database; on a rail that now carries every article the model read, it is a
 * column of noise where the titles should be. A read in flight shows its tool
 * name alone until the result arrives with a name for it.
 */
const TELLING_KEYS = ["topic", "query", "url", "name", "title", "metric"]

/** `art_9f2c…`, `fed_11b0…` — opaque to everyone but the query that uses it. */
const OPAQUE_ID = /^(art|scr|fed|fld|cht)_/

function tellingArgument(args: unknown): string | null {
  if (!args || typeof args !== "object") return null
  const record = args as Record<string, unknown>

  for (const key of TELLING_KEYS) {
    const value = record[key]
    if (typeof value === "string" && value.trim()) return truncate(value)
  }

  for (const value of Object.values(record)) {
    if (
      typeof value === "string" &&
      value.trim() &&
      value.length < 120 &&
      !OPAQUE_ID.test(value)
    ) {
      return truncate(value)
    }
  }

  return null
}

function truncate(value: string): string {
  const trimmed = value.trim()
  return trimmed.length > 48 ? `${trimmed.slice(0, 47)}…` : trimmed
}
