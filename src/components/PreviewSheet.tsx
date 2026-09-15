import { memo, useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { useQuery } from "@tanstack/react-query"
import { BookOpen, ExternalLink, Globe, Loader2, X } from "lucide-react"
import type { ArticleRow } from "@/components/ArticleGrid"
import { previewQuery } from "@/lib/preview-query"
import { handleReaderMediaError } from "@/lib/reader-media"
import { useWorkspaceScope } from "@/components/WorkspaceDataProvider"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { ReaderCopyButton } from "@/components/ReaderCopyButton"
import { ReaderControls } from "@/components/ReaderControls"
import { ReaderContents } from "@/components/ReaderContents"
import { useReaderContents } from "@/hooks/use-reader-contents"
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

// Scroll tracking updates the parent frequently. Keep React from replacing
// the HTML nodes (and invalidating heading references) on those renders.
const ReaderProse = memo(function ReaderProseContent({
  html,
  proseRef,
}: {
  html: string
  proseRef: (element: HTMLDivElement | null) => void
}) {
  return (
    <div
      ref={proseRef}
      className="reader-prose max-w-none"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
})

export function PreviewSheet(props: PreviewSheetProps) {
  return <ArticlePreviewSheet key={props.article?.id ?? "closed"} {...props} />
}

function ArticlePreviewSheet({ article, onClose }: PreviewSheetProps) {
  const [mode, setMode] = useState<PreviewMode>("reader")
  const [liveRequested, setLiveRequested] = useState(false)
  const [frameLoaded, setFrameLoaded] = useState(false)
  const readerScroll = useRef<HTMLElement | null>(null)
  const savedScroll = useRef(0)
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
    enabled: liveRequested && !!scope && !!article && !guest,
    staleTime: 15 * 60_000,
    retry: false,
  })
  const checkingLive = liveRequested && embed.isPending
  const returnToReader = useCallback(
    (notify = false) => {
      setLiveRequested(false)
      setMode("reader")
      setFrameLoaded(false)
      if (notify)
        toast.info(
          "Live preview isn’t available for this site. Showing Reader instead.",
          {
            id: `live-unavailable-${article?.id}`,
            action: {
              label: "Open original",
              onClick: () => window.open(link, "_blank", "noopener,noreferrer"),
            },
          }
        )
    },
    [article?.id, link]
  )

  useEffect(() => {
    if (!liveRequested || embed.isPending) return
    if (embed.data?.canEmbed === false) returnToReader(true)
    else setMode("live")
  }, [liveRequested, embed.isPending, embed.data?.canEmbed, returnToReader])

  useEffect(() => {
    if (mode !== "live" || frameLoaded) return
    const timer = window.setTimeout(() => returnToReader(true), 15_000)
    return () => window.clearTimeout(timer)
  }, [mode, frameLoaded, returnToReader])

  const fontScale = useReaderPrefs((s) => s.fontScale)
  const readerWidth = useReaderPrefs((s) => s.width)
  const readerTheme = useReaderPrefs((s) => s.theme)
  const zenMode = useReaderPrefs((s) => s.zenMode)
  const contents = useReaderContents(article?.id ?? "", data?.readerHtml)
  // Guest descriptions are plain text in Reader, never trusted HTML.
  const guestText = guest
    ? (article?.description
        ?.replace(/<[^>]*>/g, "")
        .replace(/\s+/g, " ")
        .trim() ?? "")
    : ""
  const copyHtml =
    data?.readerHtml || guestText.replace(/&/g, "&amp;").replace(/</g, "&lt;")
  const copyHasContent =
    /<(?:img|video|audio|iframe)\b/i.test(copyHtml) ||
    !!copyHtml
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;|&#160;/g, " ")
      .trim()
  const copyInput = {
    html: copyHtml,
    title: article?.title ?? "",
    url: link,
    image: article?.image,
    publishedAt: article?.publishedAt,
    summary: !!guest || data?.quality === "summary",
    partial: data?.notice === "partial",
  }

  const attachReaderScroll = useCallback(
    (node: HTMLDivElement | null) => {
      readerScroll.current = node
      contents.scrollRef(node)
      if (node) node.scrollTop = savedScroll.current
    },
    [contents.scrollRef]
  )

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
          <div className="flex max-w-[40%] min-w-0 shrink items-center gap-1">
            <span className="truncate text-xs font-medium text-zinc-300">
              {domain}
            </span>
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              title="Open original"
              className="shrink-0"
            >
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-zinc-500 hover:text-white"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            </a>
          </div>

          {/* Reader / Live segmented toggle */}
          <div className="flex items-center gap-0.5 rounded-full border border-white/10 bg-white/5 p-0.5">
            <button
              onClick={() => returnToReader()}
              aria-pressed={mode === "reader"}
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
              onClick={() => {
                if (mode === "live") return
                savedScroll.current =
                  readerScroll.current?.scrollTop ?? savedScroll.current
                setFrameLoaded(false)
                setLiveRequested(true)
              }}
              aria-pressed={mode === "live"}
              disabled={!!guest || checkingLive}
              title="Check whether this site allows Live view"
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                mode === "live"
                  ? "bg-white text-black"
                  : "text-zinc-400 hover:text-white",
                !!guest && "cursor-not-allowed opacity-40 hover:text-zinc-400"
              )}
            >
              {checkingLive ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Globe className="h-3 w-3" />
              )}
              Live
            </button>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {mode === "reader" && article && (
              <ReaderCopyButton
                input={copyInput}
                disabled={loading || !copyHasContent}
                bodyHeight={contents.height}
                gutter={!zenMode && !contents.mobile && contents.gutter >= 80}
              />
            )}
            {mode === "reader" && <ReaderControls />}
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
        <div className="relative min-h-0 flex-1">
          {mode !== "live" && loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
            </div>
          ) : mode === "live" ? (
            <div className="relative h-full">
              <div className="flex items-center justify-end gap-3 border-b border-white/10 px-3 py-1 text-xs text-zinc-400">
                {!frameLoaded && <span role="status">Loading website…</span>}
                <button
                  className="underline underline-offset-2 focus-visible:outline"
                  onClick={() => returnToReader()}
                >
                  Back to Reader
                </button>
              </div>
              <iframe
                src={link}
                title={article?.title ?? "Live page"}
                className="h-[calc(100%-28px)] w-full border-0 bg-white"
                sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-presentation"
                referrerPolicy="strict-origin-when-cross-origin"
                onLoad={() => setFrameLoaded(true)}
                onError={() => returnToReader(true)}
              />
            </div>
          ) : (
            <div
              className="reader-surface relative h-full"
              data-reader-theme={readerTheme}
            >
              <div
                ref={attachReaderScroll}
                className="reader-surface h-full overflow-y-auto px-6 py-10 sm:px-8"
                data-reader-theme={readerTheme}
                style={
                  { "--reader-font-scale": fontScale } as React.CSSProperties
                }
                onClick={handleReaderClick}
                onErrorCapture={(event) =>
                  handleReaderMediaError(event.target, link)
                }
              >
                <div
                  ref={contents.articleRef}
                  className={cn(
                    "mx-auto",
                    readerWidth === "wide" ? "max-w-4xl" : "max-w-2xl"
                  )}
                >
                  {data?.quality === "summary" && (
                    <p className="mb-4 text-sm text-zinc-400">
                      {data.notice === "blocked"
                        ? "This publisher blocked the reader request. Showing the feed summary."
                        : "Summary only. Open the original for the complete article."}
                    </p>
                  )}
                  {data?.notice === "partial" && (
                    <p
                      className="mb-4 text-sm"
                      style={{ color: "var(--reader-muted)" }}
                    >
                      This saved article may be incomplete. Open the original
                      for the complete article.
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
                      />
                    </div>
                  )}

                  {data?.readerHtml ? (
                    <ReaderProse
                      html={data.readerHtml}
                      proseRef={contents.proseRef}
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
              <ReaderContents
                {...contents}
                zenMode={zenMode}
                theme={readerTheme}
              />
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
