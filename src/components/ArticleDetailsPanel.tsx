import { BookOpen, Bookmark, Clock, Copy, ExternalLink, Heart, Rss, Timer, X } from "lucide-react"
import type { ReactNode } from "react"
import type { ArticleRow } from "@/components/ArticleGrid"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { ShareMenu } from "@/components/ShareMenu"
import { ArticleThumb } from "@/components/ArticleThumb"
import { useReaderStore } from "@/store/readerStore"
import { useWorkspaceNavigation, useWorkspaceScope } from "@/components/WorkspaceDataProvider"
import { DEMO_MODE } from "@/lib/demo"
import { copyText } from "@/lib/clipboard"
import { toPlainText } from "@/lib/plain-text"


function getDomain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

function formatDate(date: Date | string | null | undefined) {
  if (!date) return "—"
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function formatDateTime(date: Date | string | null | undefined) {
  if (!date) return "—"
  return new Date(date).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function MetaRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 text-zinc-500">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] tracking-wide text-zinc-500 uppercase">{label}</p>
        <p className="truncate text-sm text-zinc-200">{value}</p>
      </div>
    </div>
  )
}

interface ArticleDetailsPanelProps {
  article: ArticleRow | null
  onClose: () => void
  onRead: () => void
}

// Right-side metadata panel for an article. Intentionally a growth surface —
// more features (tags, notes, related articles, actions) will land here.
export function ArticleDetailsPanel({ article, onClose, onRead }: ArticleDetailsPanelProps) {
  const domain = article ? (article.domain ?? getDomain(article.link)) : ""
  // A boolean rather than the array — see the note in ArticleCard.
  const isStarred = useReaderStore((s) => (article ? s.favorites.includes(article.id) : false))
  const scope = useWorkspaceScope()
  const navigation = useWorkspaceNavigation()
  const isFavorite = scope && !DEMO_MODE ? !!article && !!navigation.data?.favorites.personal.includes(article.id) : isStarred
  const workspaceFavorite = !!article && !!scope && !!navigation.data?.favorites.workspace.includes(article.id)

  const copyLink = async () => {
    if (!article) return
    await copyText(article.link, { successMessage: "Link copied" })
  }

  const statuses = [
    isFavorite && { label: "Personal favorite", icon: <Heart className="h-3 w-3" /> },
    workspaceFavorite && { label: "Workspace favorite", icon: <Heart className="h-3 w-3" /> },
    article?.isBookmarked && { label: "Bookmarked", icon: <Bookmark className="h-3 w-3" /> },
    article?.isReadLater && { label: "Read later", icon: <Timer className="h-3 w-3" /> },
  ].filter(Boolean) as Array<{ label: string; icon: ReactNode }>

  return (
    <Sheet open={!!article} onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="flex w-[360px] max-w-[85vw] flex-col border-l border-white/10 bg-[#111111] p-0 sm:max-w-[85vw]"
      >
        <SheetTitle className="sr-only">Article details</SheetTitle>

        {/* Header */}
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-white/10 px-4">
          <span className="text-xs font-semibold tracking-wide text-zinc-300 uppercase">Details</span>
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

        {article && (
          <div className="flex-1 overflow-y-auto p-4">
            {/*
              Rendered whether or not there is an image. The panel opens from a
              card that was already showing this source's mark, so dropping the
              banner for an imageless article made the panel look like a
              different, emptier component every few articles.
            */}
            <div className="mb-4 h-40 overflow-hidden rounded-lg border border-white/10">
              <ArticleThumb
                src={article.image}
                link={article.link}
                name={article.feedName}
                scale="lg"
              />
            </div>

            <h2 className="mb-3 text-base leading-snug font-semibold text-white">
              {article.title}
            </h2>

            {article.description && (
              <p className="mb-5 text-sm leading-relaxed text-zinc-400">
                {toPlainText(article.description)}
              </p>
            )}

            <div className="space-y-3.5">
              <MetaRow icon={<Rss className="h-3.5 w-3.5" />} label="Source" value={domain} />
              {article.feedName && (
                <MetaRow icon={<Rss className="h-3.5 w-3.5" />} label="Feed" value={article.feedName} />
              )}
              <MetaRow icon={<Clock className="h-3.5 w-3.5" />} label="Published" value={formatDateTime(article.publishedAt)} />
              <MetaRow icon={<Clock className="h-3.5 w-3.5" />} label="Added" value={formatDate(article.createdAt)} />
            </div>

            {statuses.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-1.5">
                {statuses.map((s) => (
                  <span
                    key={s.label}
                    className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-300"
                  >
                    {s.icon}
                    {s.label}
                  </span>
                ))}
              </div>
            )}

            <div className="mt-5">
              <p className="mb-1.5 text-[11px] tracking-wide text-zinc-500 uppercase">Link</p>
              <div className="flex items-center gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-xs text-zinc-300">{article.link}</span>
                  <button
                    onClick={copyLink}
                    title="Copy link"
                    aria-label="Copy link"
                    className="shrink-0 text-zinc-400 transition-colors hover:text-white"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
                <ShareMenu url={article.link} title={article.title} />
              </div>
            </div>

            <div className="mt-5 flex gap-2">
              <button
                onClick={onRead}
                className="flex h-9 flex-1 items-center justify-center gap-2 rounded-full bg-white text-sm font-semibold text-black transition-colors hover:bg-zinc-200"
              >
                <BookOpen className="h-3.5 w-3.5" />
                Read
              </button>
              <a
                href={article.link}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-9 flex-1 items-center justify-center gap-2 rounded-full border border-white/15 bg-white/5 text-sm font-semibold text-white transition-colors hover:bg-white/10"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open original
              </a>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
