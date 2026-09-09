import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { BookOpen, ExternalLink, Globe, Loader2, X } from "lucide-react"
import type { ArticleRow } from "@/components/ArticleGrid"
import { previewQuery } from "@/lib/preview-query"
import { useWorkspaceScope } from "@/components/WorkspaceDataProvider"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { ReaderControls } from "@/components/ReaderControls"
import { useReaderPrefs } from "@/store/readerPrefs"
import { cn } from "@/lib/utils"
import { useGuestShare } from "@/hooks/guest-share-context"
import { getArticleEmbedAvailability } from "@/server/rss"

// Render mode for the preview. 'reader' = extracted/sanitized article HTML,
// 'live' = the real page in an iframe. Future modes ('snapshot', 'proxy') drop
// in here without changing the surrounding UI.
type PreviewMode = "reader" | "live"

interface PreviewSheetProps {
  article: ArticleRow | null
  onClose: () => void
}

export function PreviewSheet({ article, onClose }: PreviewSheetProps) {
  const [mode, setMode] = useState<PreviewMode>("reader")
  const guest = useGuestShare()
  const scope = useWorkspaceScope()
  const preview = useQuery({
    ...previewQuery(
      scope ?? { userId: "guest", workspaceId: "guest" },
      article?.id ?? ""
    ),
    enabled: !!article && !!scope && !guest,
  })
  const data = preview.data
  const loading = !!scope && !guest && preview.isPending

  const domain = data?.domain ?? article?.domain ?? ""
  const link = data?.link ?? article?.link ?? "#"
  const embed = useQuery({
    queryKey: [
      "workspace",
      scope?.userId,
      scope?.workspaceId,
      "embed",
      article?.id,
    ],
    queryFn: ({ signal }) =>
      getArticleEmbedAvailability({
        data: { ...scope!, id: article!.id },
        signal,
      }),
    enabled: mode === "live" && !!scope && !!article && !guest,
    staleTime: 15 * 60_000,
    retry: false,
  })
  const canEmbed = embed.data?.canEmbed ?? data?.canEmbed ?? false

  const fontScale = useReaderPrefs((s) => s.fontScale)
  const readerWidth = useReaderPrefs((s) => s.width)
  const readerTheme = useReaderPrefs((s) => s.theme)

  // Table-of-contents / in-page anchors: if a link points at an id present in
  // the reader content, scroll to it here instead of opening the external page.
  const handleReaderClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement).closest("a")
    if (!anchor) return
    const href = anchor.getAttribute("href")
    if (!href) return

    let fragment = ""
    try {
      if (!href.startsWith("#")) {
        const destination = new URL(href, link)
        const source = new URL(link)
        if (
          destination.origin !== source.origin ||
          destination.pathname !== source.pathname ||
          destination.search !== source.search
        )
          return
      }
      fragment = href.startsWith("#")
        ? decodeURIComponent(href.slice(1))
        : decodeURIComponent(new URL(href, link).hash.slice(1))
    } catch {
      return
    }
    if (!fragment) return // external link with no in-page target — let it open

    const container = e.currentTarget
    const targetEl =
      container.querySelector(`#${CSS.escape(fragment)}`) ??
      container.querySelector(`[name="${CSS.escape(fragment)}"]`)
    if (targetEl) {
      e.preventDefault()
      targetEl.scrollIntoView({ behavior: "smooth", block: "start" })
    }
  }

  return (
    <Sheet
      open={!!article}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent
        side="bottom"
        showCloseButton={false}
        // Inline height wins over the primitive's data-[side=bottom]:h-auto,
        // which has higher specificity than a Tailwind h-* utility class.
        style={{ height: "90vh" }}
        className="flex flex-col border-t border-white/10 bg-[#111111] p-0"
      >
        <SheetTitle className="sr-only">
          {article?.title ?? "Article preview"}
        </SheetTitle>

        {/* Header bar */}
        <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-white/10 px-3">
          <span className="max-w-[40%] truncate text-xs font-medium text-zinc-300">
            {domain}
          </span>

          {/* Reader / Live segmented toggle */}
          <div className="flex items-center gap-0.5 rounded-full border border-white/10 bg-white/5 p-0.5">
            <button
              onClick={() => setMode("reader")}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                mode === "reader"
                  ? "bg-white text-black"
                  : "text-zinc-400 hover:text-white"
              )}
            >
              <BookOpen className="h-3 w-3" />
              Reader
            </button>
            <button
              onClick={() => setMode("live")}
              disabled={!!guest}
              title="Check whether this site allows Live view"
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                mode === "live"
                  ? "bg-white text-black"
                  : "text-zinc-400 hover:text-white",
                !!guest && "cursor-not-allowed opacity-40 hover:text-zinc-400"
              )}
            >
              <Globe className="h-3 w-3" />
              Live
            </button>
          </div>

          <div className="flex items-center gap-1">
            {mode === "reader" && <ReaderControls />}
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              title="Open original"
            >
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-zinc-500 hover:text-white"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            </a>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label="Close"
              className="h-6 w-6 text-zinc-500 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1">
          {loading || (mode === "live" && embed.isFetching) ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
            </div>
          ) : mode === "live" && canEmbed ? (
            <iframe
              src={link}
              title={article?.title ?? "Live page"}
              className="h-full w-full border-0 bg-white"
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
              referrerPolicy="no-referrer-when-downgrade"
              onError={() => setMode("reader")}
            />
          ) : (
            <div
              className="reader-surface h-full overflow-y-auto px-6 py-10 sm:px-8"
              data-reader-theme={readerTheme}
              style={
                { "--reader-font-scale": fontScale } as React.CSSProperties
              }
              onClick={handleReaderClick}
            >
              <div
                className={cn(
                  "mx-auto",
                  readerWidth === "wide" ? "max-w-4xl" : "max-w-2xl"
                )}
              >
                {mode === "live" && !canEmbed && (
                  <p className="mb-4 text-sm text-zinc-400">
                    This site does not allow Live view. Showing the saved reader
                    view instead.
                  </p>
                )}
                {data?.quality === "summary" && (
                  <p className="mb-4 text-sm text-zinc-400">
                    Summary only. Open the original for the complete article.
                  </p>
                )}
                {article?.feedName && (
                  <p
                    className="mb-2 text-sm font-semibold tracking-wider uppercase"
                    style={{ color: "var(--reader-muted)" }}
                  >
                    {article.feedName}
                  </p>
                )}
                {article?.title && (
                  <h1
                    className="mb-6 text-3xl leading-tight font-bold tracking-tight"
                    style={{ color: "var(--reader-heading)" }}
                  >
                    {article.title}
                  </h1>
                )}

                {article?.image && (
                  <div className="mb-8 overflow-hidden rounded-xl border border-white/10 bg-white/5">
                    <img
                      src={article.image}
                      alt={article.title}
                      className="h-auto w-full object-cover"
                      onError={(e) => {
                        ;(e.target as HTMLElement).style.display = "none"
                      }}
                    />
                  </div>
                )}

                {data?.readerHtml ? (
                  <div
                    className="reader-prose max-w-none"
                    dangerouslySetInnerHTML={{ __html: data.readerHtml }}
                  />
                ) : guest ? (
                  /*
                    The feed's own summary, as plain text. Not dangerouslySet:
                    a description is whatever the publisher put in the feed and
                    has not been through the sanitizer that reader HTML has.
                  */
                  <>
                    {article?.description && (
                      <p
                        className="text-base leading-relaxed"
                        style={{ color: "var(--reader-text)" }}
                      >
                        {article.description
                          .replace(/<[^>]*>/g, "")
                          .replace(/\s+/g, " ")
                          .trim()}
                      </p>
                    )}
                    <p
                      className="mt-6 text-sm italic"
                      style={{ color: "var(--reader-muted)" }}
                    >
                      Sign in to Sparkfeed to read the full article here.
                    </p>
                  </>
                ) : (
                  <p
                    className="italic"
                    style={{ color: "var(--reader-muted)" }}
                  >
                    Couldn&apos;t load a reader view for this article.
                  </p>
                )}

                <div className="mt-12 flex justify-center pb-12">
                  <a
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="h-10 rounded-full border px-8 text-sm leading-10 font-bold transition-opacity hover:opacity-80"
                    style={{
                      borderColor: "var(--reader-border)",
                      color: "var(--reader-heading)",
                      background: "var(--reader-soft)",
                    }}
                  >
                    Open original on {domain}
                  </a>
                </div>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
