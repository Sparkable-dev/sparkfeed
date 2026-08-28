import * as React from "react"
import { AlertTriangleIcon, Loader2Icon } from "lucide-react"
import type { ArticleArtifact } from "./artifact-context"
import { getArticlePreview } from "@/server/rss"
import { readExternalUrl } from "@/server/reader"
import { ReaderControls } from "@/components/ReaderControls"
import { useReaderPrefs } from "@/store/readerPrefs"
import { cn } from "@/lib/utils"

/**
 * An article, read in the panel.
 *
 * The reader itself is not new — `.reader-prose`, `ReaderControls` and
 * `useReaderPrefs` are the same three pieces the bottom-sheet preview has used
 * since it shipped, so font size, width and theme are one setting across the
 * app rather than two that drift. What is new is *where* the text comes from:
 * an article in the workspace resolves through `getArticlePreview`, and a bare
 * URL through `readExternalUrl`, which is the path that did not exist before.
 *
 * Fetched here rather than passed in. The text is often longer than the whole
 * conversation that mentioned it, and threading it through the message would
 * mean every later turn paid for it again.
 */

export interface ArticleContent {
  title: string | null
  byline: string | null
  domain: string
  url: string
  readerHtml: string | null
  canEmbed: boolean
}

export function useArticleContent(source: ArticleArtifact["source"]) {
  const [state, setState] = React.useState<{
    loading: boolean
    error: string | null
    content: ArticleContent | null
  }>({ loading: true, error: null, content: null })

  /*
    Pulled apart into primitives before the effect, rather than depending on
    `source` and silencing the lint. The object is rebuilt on every render of
    the card that opened it, so depending on it directly would refetch the
    article continuously; these three values change only when the article does.
  */
  const kind = source.type
  const url = source.type === "url" ? source.url : null
  const articleId = source.type === "workspace" ? source.articleId : null

  React.useEffect(() => {
    let cancelled = false
    setState({ loading: true, error: null, content: null })

    const load = async (): Promise<ArticleContent> => {
      if (kind === "url" && url) {
        const result = await readExternalUrl({ data: { url } })
        return {
          title: result.title,
          byline: result.byline,
          domain: result.domain,
          url: result.url,
          readerHtml: result.reader_html,
          canEmbed: result.can_embed,
        }
      }

      if (!articleId) throw new Error("Nothing to read.")
      const result = await getArticlePreview({ data: { id: articleId } })
      return {
        title: null,
        byline: null,
        domain: result.domain,
        url: result.link,
        readerHtml: result.readerHtml,
        canEmbed: result.canEmbed,
      }
    }

    void load()
      .then((content) => {
        if (!cancelled) setState({ loading: false, error: null, content })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setState({
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : "That page could not be read.",
          content: null,
        })
      })

    return () => {
      cancelled = true
    }
  }, [kind, url, articleId])

  return state
}

export function ArticleReader({
  title,
  content,
  loading,
  error,
}: {
  title: string
  content: ArticleContent | null
  loading: boolean
  error: string | null
}) {
  const fontScale = useReaderPrefs((s) => s.fontScale)
  const readerWidth = useReaderPrefs((s) => s.width)
  const readerTheme = useReaderPrefs((s) => s.theme)

  if (loading) {
    return (
      <div className="grid h-full place-items-center text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <Loader2Icon className="size-4 animate-spin" />
          Fetching the article…
        </span>
      </div>
    )
  }

  if (error || !content?.readerHtml) {
    return (
      <div className="grid h-full place-items-center px-8 text-center">
        <div className="max-w-sm space-y-2">
          <AlertTriangleIcon className="mx-auto size-5 text-muted-foreground" />
          <p className="text-sm text-foreground">
            {error ?? "There was no readable article on that page."}
          </p>
          {/*
            Only when extraction came back empty. A specific failure — demo
            mode, a blocked address, a 404 — already says what happened, and
            following it with a guess about paywalls would read as the app not
            knowing which of the two it was.
          */}
          {error ? null : (
            <p className="text-xs text-muted-foreground">
              Some pages are a paywall, a login, or an app shell with nothing in
              the HTML. Open it in a new tab to see it as the publisher
              intended.
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      className="reader-surface h-full overflow-y-auto px-6 py-8 sm:px-8"
      data-reader-theme={readerTheme}
      style={{ "--reader-font-scale": fontScale } as React.CSSProperties}
    >
      <div
        className={cn(
          "mx-auto",
          readerWidth === "wide" ? "max-w-4xl" : "max-w-2xl"
        )}
      >
        <p
          className="mb-2 text-xs font-semibold tracking-wider uppercase"
          style={{ color: "var(--reader-muted)" }}
        >
          {content.domain}
          {content.byline ? ` · ${content.byline}` : ""}
        </p>
        <h1
          className="mb-6 text-3xl leading-tight font-bold tracking-tight"
          style={{ color: "var(--reader-heading)" }}
        >
          {content.title ?? title}
        </h1>
        {/*
          The HTML has been through `sanitizeArticleHtml`, which drops scripts,
          styles and iframes with their contents and allows a fixed tag set. It
          is the same sanitizer and the same call site the bottom sheet uses.
        */}
        <div
          className="reader-prose max-w-none"
          dangerouslySetInnerHTML={{ __html: content.readerHtml }}
        />
      </div>
    </div>
  )
}

export { ReaderControls }
