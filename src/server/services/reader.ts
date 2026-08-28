import { checkCanEmbed, extractReadable } from "../utils/extract"
import { safeFetchText } from "../utils/fetch"
import { htmlToMarkdown } from "./markdown"
import { invalidArgument, upstreamFailed } from "./errors"
import type { ApiPrincipal } from "../api/principal"

/**
 * Reading a page that is not in the workspace.
 *
 * Every existing path to article text starts from a row: `getArticlePreview`
 * and `getArticle` both take an id, look it up workspace-scoped, and fetch the
 * link they find. That is deliberate — an unscoped id would let a caller make
 * the server fetch any URL stored in any workspace — but it left no way to read
 * a link someone pasted, which is most of what "check this news" means.
 *
 * So this composes the four primitives that already exist —`safeFetchText`
 * (which calls `assertPublicUrl` and re-validates every redirect),
 * `extractReadable`, `checkCanEmbed` and `htmlToMarkdown` — into the one thing
 * that was missing. The precedent is `probeUrl`: a public page, read-only,
 * SSRF-guarded, and nothing written.
 */

const TIMEOUT_MS = 10_000
/** Long enough for a feature; short enough that one page cannot fill a context. */
const MAX_MARKDOWN_CHARS = 40_000

export interface ReadUrlResult {
  /** After redirects — the address actually read, which may not be the one given. */
  url: string
  requested_url: string
  domain: string
  title: string | null
  byline: string | null
  excerpt: string | null
  image: string | null
  word_count: number
  /** Sanitized HTML for the reader pane. Null when nothing could be extracted. */
  reader_html: string | null
  /** Markdown of the same content, for the model. Truncated. */
  content: string
  truncated: boolean
  /** Whether the live page may be shown in a frame; see `checkCanEmbed`. */
  can_embed: boolean
  /** `extracted` when Readability found an article, `failed` when it did not. */
  source_quality: "extracted" | "failed"
}

export async function readUrl(
  principal: ApiPrincipal,
  args: { url: string }
): Promise<ReadUrlResult> {
  /*
    Demo is public and unauthenticated. An endpoint there that fetches whatever
    URL it is handed is an open proxy with our egress address on it — the same
    reason `find_feeds`'s url branch and `getArticle`'s live fetch are both
    closed in demo.
  */
  if (principal.demo) {
    throw invalidArgument("Reading external pages is disabled in demo mode.")
  }

  let fetched
  try {
    fetched = await safeFetchText(args.url, { timeoutMs: TIMEOUT_MS })
  } catch (err) {
    // BlockedUrlError and the size cap both carry messages written for a human.
    throw upstreamFailed(
      err instanceof Error ? err.message : "Could not reach that page."
    )
  }

  if (!fetched.res.ok) {
    throw upstreamFailed(
      `That page returned ${fetched.res.status}. It may be gone, or behind a login.`
    )
  }

  const finalUrl = fetched.finalUrl || args.url
  const readable = extractReadable(fetched.text, finalUrl)

  const markdown = readable ? htmlToMarkdown(readable.contentHtml) : ""
  const truncated = markdown.length > MAX_MARKDOWN_CHARS

  return {
    url: finalUrl,
    requested_url: args.url,
    domain: domainOf(finalUrl),
    title: readable?.title ?? null,
    byline: readable?.byline ?? null,
    excerpt: readable?.excerpt ?? null,
    image: readable?.image ?? null,
    word_count: countWords(markdown),
    reader_html: readable?.contentHtml ?? null,
    content: truncated ? markdown.slice(0, MAX_MARKDOWN_CHARS) : markdown,
    truncated,
    can_embed: checkCanEmbed(fetched.res.headers),
    /*
      A page that would not extract is reported, not thrown on. Plenty of real
      pages are a paywall, a cookie wall or a JavaScript shell — the model needs
      to be able to say "I could not read that one" and move on rather than
      treat it as a tool failure and retry.
    */
    source_quality: readable ? "extracted" : "failed",
  }
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

function countWords(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}
