import { useState } from "react"
import {
  AlertCircle,
  ArrowRight,
  ArrowUp,
  Check,
  Link as LinkIcon,
  Loader2,
  Rss,
  Sparkles,
} from "lucide-react"
import type {UrlProbeResult} from "@/server/url-probe";
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAddFeed, useFeedsChanged } from "@/components/add-feed/add-feed-context"
import {  probeUrl } from "@/server/url-probe"

/**
 * Paste a link, find out whether it can become a feed.
 *
 * The catalogue below answers "what should I read"; this answers "can I read
 * *this* here", which is the question people actually arrive with. It is
 * deliberately the one thing above the fold, and deliberately does not add
 * anything on its own — it reports, and the user decides.
 *
 * Three outcomes, because there are genuinely three: the site publishes RSS and
 * simply never advertised it, or it does not but is a page we can read anyway,
 * or it is neither and the honest answer is to say so.
 */

/** Doubles as instructions: the fastest way to explain what to paste. */
const EXAMPLES = [
  { label: "stratechery.com", url: "https://stratechery.com" },
  { label: "paulgraham.com", url: "https://paulgraham.com" },
  { label: "openai.com/news", url: "https://openai.com/news" },
]

type State =
  | { phase: "idle" }
  | { phase: "checking"; url: string }
  | { phase: "done"; result: UrlProbeResult }

/** Accepts "theverge.com" as readily as a full URL — people paste both. */
function normalizeInput(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(withScheme)
    return url.hostname.includes(".") ? url.href : null
  } catch {
    return null
  }
}

function ResultPanel({
  result,
  onAdd,
}: {
  result: UrlProbeResult
  onAdd: (url: string) => void
}) {
  const shell =
    "mt-3 rounded-xl border bg-black/40 px-4 py-3 text-left backdrop-blur-md"

  if (result.status === "error") {
    return (
      <div className={`${shell} border-red-500/20`}>
        <div className="flex items-start gap-2.5">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-400" />
          <div className="min-w-0">
            {/* `message` is already a written sentence — see feed-errors.ts. */}
            <p className="text-sm font-medium text-zinc-100">
              Could not check that link
            </p>
            <p className="mt-0.5 text-xs text-zinc-400">{result.error.message}</p>
          </div>
        </div>
      </div>
    )
  }

  if (result.status === "none") {
    return (
      <div className={`${shell} border-white/10`}>
        <div className="flex items-start gap-2.5">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-400/80" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-zinc-100">
              This page can't be turned into a feed
            </p>
            <p className="mt-0.5 text-xs text-zinc-400">
              We found no RSS feed on the site, and the page has no list of posts
              we can read. Try the site's blog or news section directly.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const isRss = result.status === "rss"

  return (
    <div className={`${shell} border-white/10`}>
      <div className="flex items-start gap-2.5">
        {isRss ? (
          <Check className="mt-0.5 size-4 shrink-0 text-emerald-400" />
        ) : (
          <Sparkles className="mt-0.5 size-4 shrink-0 text-sky-400" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium text-zinc-100">
              {isRss ? (result.title ?? "Feed found") : "No RSS, but we can read this page"}
            </p>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-zinc-300 uppercase">
              <Rss className="size-2.5" />
              {isRss ? "RSS" : "Converted"}
            </span>
          </div>

          <p className="mt-0.5 truncate text-xs text-zinc-500">
            {isRss ? result.feedUrl : `${result.count} posts found on the page`}
          </p>

          {result.sampleTitles.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {result.sampleTitles.slice(0, 3).map((title) => (
                <li key={title} className="truncate text-xs text-zinc-400">
                  <span className="text-zinc-600">— </span>
                  {title}
                </li>
              ))}
            </ul>
          )}
        </div>

        <Button
          size="sm"
          onClick={() => onAdd(isRss ? result.feedUrl : result.url)}
          className="h-8 shrink-0 bg-white text-xs font-semibold text-black hover:bg-zinc-200"
        >
          Add
          <ArrowRight className="ml-1 size-3" />
        </Button>
      </div>
    </div>
  )
}

export function DiscoverHero({ onFeedAdded }: { onFeedAdded: () => void }) {
  const [state, setState] = useState<State>({ phase: "idle" })
  const [text, setText] = useState("")
  const { openAddFeed } = useAddFeed()
  useFeedsChanged(onFeedAdded)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const url = normalizeInput(text)
    if (!url) return

    setState({ phase: "checking", url })
    try {
      const result = await probeUrl({ data: { url } })
      setState({ phase: "done", result })
    } catch {
      setState({
        phase: "done",
        result: { status: "none", url },
      })
    }
  }

  /*
    Hands off to the app's one Add-sources dialog rather than adding here. That
    dialog already owns folder choice, section feeds and the duplicate check —
    reimplementing any of it would just be a second way to get it wrong. This
    file used to mount its own copy of it; now it just names the address.
  */
  const handleAdd = (url: string) => openAddFeed({ url })

  return (
    <section className="relative isolate mb-10 overflow-hidden rounded-2xl border border-white/10">
      <img
        src="/discover-hero.jpg"
        alt=""
        /*
          Decorative, so it is hidden from assistive tech and never blocks the
          input behind it. `object-bottom` keeps the ridgeline at the base of the
          panel whatever the height, so the sky — the legible part — is what sits
          behind the text.
        */
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 h-full w-full object-cover object-bottom"
      />
      {/* Guarantees contrast rather than hoping the photograph provides it. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-black/70 via-black/40 to-black/70"
      />

      <div className="mx-auto flex max-w-2xl flex-col items-center px-6 py-12 text-center sm:py-16">
        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
          Turn any site into a feed
        </h1>
        <p className="mt-2 max-w-md text-sm text-zinc-300">
          Paste a link. We'll find its RSS, and if there isn't one, we'll read the
          page instead.
        </p>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-1.5">
          {EXAMPLES.map((ex) => (
            <button
              key={ex.url}
              type="button"
              onClick={() => setText(ex.url)}
              className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px]
                font-medium text-zinc-200 backdrop-blur-md transition-colors hover:bg-white/20"
            >
              {ex.label}
            </button>
          ))}
        </div>

        {/*
          A plain shadcn Input and Button rather than the AI Elements
          PromptInput. That component is built around a chat composer — a
          multi-line textarea with a toolbar row — and every attempt to compress
          it to one line left a nested addon box drawing a second border inside
          the first. One field and one button is what this actually is.
        */}
        <form onSubmit={handleSubmit} className="relative mx-auto mt-4 w-full max-w-lg">
          <LinkIcon
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-zinc-400"
          />
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste a link"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            aria-label="Site or feed address"
            className="h-12 rounded-full border-white/15 bg-black/30 pr-14 pl-11 text-sm text-white
              shadow-lg backdrop-blur-md placeholder:text-zinc-400
              focus-visible:border-white/30 focus-visible:ring-white/20"
          />
          <Button
            type="submit"
            size="icon"
            disabled={!normalizeInput(text) || state.phase === "checking"}
            aria-label="Check this link"
            className="absolute top-1/2 right-1.5 size-9 -translate-y-1/2 rounded-full bg-white
              text-black hover:bg-zinc-200 disabled:bg-white/15 disabled:text-zinc-500"
          >
            {state.phase === "checking" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ArrowUp className="size-4" />
            )}
          </Button>
        </form>

        {/* Outside the field — inside it, this was half the box's height. */}
        <p className="mt-2.5 text-[11px] text-zinc-400">
          Works with blogs, newsletters and news sites
        </p>

        <div className="mx-auto w-full max-w-lg">

          {state.phase === "checking" && (
            <div className="mt-3 flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/40 px-4 py-3 backdrop-blur-md">
              <Loader2 className="size-3.5 animate-spin text-zinc-400" />
              <span className="text-xs text-zinc-400">
                Looking for a feed on {new URL(state.url).hostname}…
              </span>
            </div>
          )}

          {state.phase === "done" && (
            <ResultPanel result={state.result} onAdd={handleAdd} />
          )}
        </div>
      </div>

    </section>
  )
}
