import { feedUrlKey } from "@/lib/validation"

/**
 * Remembers which URLs we have actually resolved, per workspace.
 *
 * The Add dialog checks a batch of URLs, the user ticks some, and then submits
 * them. The server must not simply trust that list — a client could name a URL
 * it never checked. But re-resolving every one at submit time throws away the
 * work just done and turns a 100ms request back into a slow one.
 *
 * So: every resolve path records what it proved here, and the write path
 * accepts anything it recognises. A miss — a restart, an expiry, or a client
 * naming a URL out of thin air — falls back to resolving properly. The common
 * case costs nothing; the adversarial case costs exactly what it would have.
 *
 * In-process and lossy on purpose. This is a shortcut, never a source of truth:
 * losing it makes the next submit slower and nothing else. That is also why it
 * is not in the database.
 */

const TTL_MS = 15 * 60 * 1000
/** Bounded so a long-lived process cannot grow this without limit. */
const MAX_ENTRIES = 1_000

interface Entry {
  /** The address that actually parsed, which is often not the one asked for. */
  url: string
  title: string | null
  /** `rss` or `page`, so the write path knows which it proved. */
  kind: "rss" | "page"
  at: number
}

const cache = new Map<string, Entry>()

function key(workspaceId: string | null, url: string): string {
  return `${workspaceId ?? "-"}::${feedUrlKey(url)}`
}

/**
 * Drops expired entries, then the oldest, if the map has grown past its cap.
 *
 * Called on write rather than on a timer: a timer would keep a Node process
 * awake for a cache nobody is using.
 */
function evict(): void {
  const now = Date.now()
  for (const [k, entry] of cache) {
    if (now - entry.at > TTL_MS) cache.delete(k)
  }
  if (cache.size <= MAX_ENTRIES) return

  // Insertion order is close enough to age order for a cache this shape.
  const excess = cache.size - MAX_ENTRIES
  let dropped = 0
  for (const k of cache.keys()) {
    cache.delete(k)
    if (++dropped >= excess) break
  }
}

export function rememberResolved(
  workspaceId: string | null,
  urls: Array<{ url: string; title: string | null; kind?: "rss" | "page" }>,
): void {
  const at = Date.now()
  for (const item of urls) {
    cache.set(key(workspaceId, item.url), {
      url: item.url,
      title: item.title,
      kind: item.kind ?? "rss",
      at,
    })
  }
  evict()
}

/** The remembered resolution, or null if this workspace never proved this URL. */
export function recallResolved(
  workspaceId: string | null,
  url: string,
): { url: string; title: string | null; kind: "rss" | "page" } | null {
  const entry = cache.get(key(workspaceId, url))
  if (!entry) return null
  if (Date.now() - entry.at > TTL_MS) {
    cache.delete(key(workspaceId, url))
    return null
  }
  return { url: entry.url, title: entry.title, kind: entry.kind }
}

/** Test seam. Nothing in the app calls this. */
export function clearResolutionCache(): void {
  cache.clear()
}
