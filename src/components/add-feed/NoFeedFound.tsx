import { ArrowRight } from "lucide-react"

/**
 * What to show when a site has no feed.
 *
 * The old panel said "No feed found on that site" and offered one button:
 * "Watch this page instead", which creates a scraped source that no part of the
 * app renders. So the most common failure — pasting `microsoft.com`, whose feed
 * lives on `blogs.microsoft.com` — dead-ended into a feature that does not work.
 *
 * This says what was actually checked, which is the difference between "there
 * is no feed" and "we did not look properly", and offers the subdomains worth
 * trying. The scraper slot below is deliberately named and deliberately inert:
 * the next phase fills it, and nothing else here has to change when it does.
 */

/** The conventional paths `resolveFeed` probes. Kept in sync by eye, not by import — see below. */
const PROBED = ["/feed", "/rss.xml", "/atom.xml", "/index.xml"]

/**
 * Subdomains that carry a site's blog often enough to be worth suggesting.
 *
 * Suggested rather than probed: probing four more hostnames per miss would
 * double the cost of every failed check to help a minority of them, and a
 * suggestion the user clicks is one round trip instead of four.
 */
const COMMON_SUBDOMAINS = ["blog", "blogs", "news", "engineering"]

function suggestionsFor(url: string): Array<string> {
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    return []
  }

  // Only from an apex-looking host. Suggesting `blog.blogs.example.com` to
  // someone already on a subdomain is noise.
  const parts = host.replace(/^www\./, "").split(".")
  if (parts.length > 2) return []

  const apex = parts.join(".")
  return COMMON_SUBDOMAINS.map((sub) => `${sub}.${apex}`)
}

export function NoFeedFound({
  url,
  onTry,
  onWatchPage,
  busy,
}: {
  url: string
  onTry: (next: string) => void
  /** Null while the scraper is unfinished, which hides the slot entirely. */
  onWatchPage: (() => void) | null
  busy: boolean
}) {
  const suggestions = suggestionsFor(url)

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border dark:border-white/[0.07] bg-muted dark:bg-white/[0.02] p-3">
      <div>
        <p className="text-sm text-foreground dark:text-zinc-200">No feed on that address.</p>
        <p className="mt-1 text-xs text-muted-foreground dark:text-zinc-500">
          We read the page's own links and tried {PROBED.join(", ")}.
        </p>
      </div>

      {suggestions.length > 0 && (
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-xs text-muted-foreground dark:text-zinc-500">Many sites keep their feed elsewhere:</p>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((host) => (
              <button
                key={host}
                type="button"
                disabled={busy}
                onClick={() => onTry(`https://${host}`)}
                className="inline-flex items-center gap-1 rounded-lg border border-border dark:border-white/10 px-2 py-1
                  text-xs text-foreground dark:text-zinc-300 transition-colors hover:bg-accent dark:hover:bg-white/10 hover:text-foreground dark:hover:text-white
                  disabled:opacity-50"
              >
                {host}
                <ArrowRight className="size-3 opacity-50" />
              </button>
            ))}
          </div>
        </div>
      )}

      {onWatchPage && (
        <button
          type="button"
          id="add-feed-scrape-btn"
          disabled={busy}
          onClick={onWatchPage}
          className="self-start rounded-lg border border-border dark:border-white/10 px-2.5 py-1 text-xs text-foreground dark:text-zinc-300
            transition-colors hover:bg-accent dark:hover:bg-white/10 hover:text-foreground dark:hover:text-white disabled:opacity-50"
        >
          Watch this page instead
        </button>
      )}
    </div>
  )
}
