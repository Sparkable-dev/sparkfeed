import { ExternalLink, PanelRightOpen, Share2 } from "lucide-react"
import type { ArticleRow } from "@/components/ArticleGrid"
import { FavoriteButton } from "@/components/FavoriteButton"
import { useArticleReader } from "@/components/ArticleReaderProvider"
import { Card, CardContent } from "@/components/ui/card"
import { copyText } from "@/lib/clipboard"
import { ArticleThumb } from "@/components/ArticleThumb"

function getDomain(url: string) {
  try {
    return new URL(url).hostname.replace("www.", "")
  } catch {
    return url
  }
}

function formatDate(date: Date | string | null) {
  if (!date) return ""
  const d = new Date(date)
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

interface ArticleCardProps {
  article: ArticleRow
  onUpdate?: () => void
}

export function ArticleCard({ article }: ArticleCardProps) {
  const { openReader, openDetails } = useArticleReader()
  const domain = article.domain ?? getDomain(article.link)

  const handleShare = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await copyText(article.link, { successMessage: "Link copied" })
  }

  return (
    <>
      <Card
        id={`article-card-${article.id}`}
        onClick={() => openReader(article)}
        className="group relative flex flex-col gap-0 overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl border-white/5 hover:border-white/10 p-0 rounded-xl cursor-pointer bg-[#161616]"
      >
        {/* Top: Image area — strict 4:3 ratio so it behaves consistently */}
        <div
          className="relative w-full overflow-hidden shrink-0"
          style={{ aspectRatio: "4/3" }}
        >
          {/*
            The zoom lives out here rather than on the image, so a card with no
            image still responds to a hover. Previously the fallback was an inert
            pastel block and only cards that happened to have artwork moved.
          */}
          <ArticleThumb
            src={article.image}
            link={article.link}
            name={article.feedName}
            className="transition-transform duration-500 group-hover:scale-105"
          />

          <div className="absolute top-2.5 right-2.5 z-10 rounded-full bg-black/50"><FavoriteButton articleId={article.id} /></div>

          {/* Source domain badge */}
          <span className="absolute bottom-3 left-3 z-10 rounded-full bg-black/60 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-white/90 backdrop-blur-md border border-white/10 shadow-xl">
            {domain}
          </span>
        </div>

        {/* Bottom: Info area — auto height prevents text clipping! */}
        <CardContent className="flex flex-col justify-between bg-[#1a1a1a] p-3 grow">
          <div className="flex flex-col gap-1 mb-2">
            {/* Published date */}
            <p className="text-[10px] text-zinc-500 leading-none">
              {formatDate(article.publishedAt)}
            </p>

            {/* Title — max 2 lines */}
            <h3 className="line-clamp-2 text-[13px] font-semibold leading-snug text-white">
              {article.title}
            </h3>
          </div>

          {/* Bottom row */}
          <div className="mt-auto flex items-center justify-end">
            {/* Action buttons */}
            <div className="flex items-center gap-0.5">

              <FavoriteButton articleId={article.id} scope="workspace" />
              {/* Details panel */}
              <button
                onClick={(e) => { e.stopPropagation(); openDetails(article) }}
                className="flex items-center justify-center rounded px-2 py-0.5 text-zinc-400 border border-white/5 bg-white/5 hover:bg-white/10 hover:text-white transition-colors ml-1 h-7 w-7"
                title="Article details"
                aria-label="Show article details"
              >
                <PanelRightOpen className="h-3 w-3" />
              </button>

              {/* Share (Icon only) */}
              <button
                onClick={handleShare}
                className="flex items-center justify-center rounded px-2 py-0.5 text-zinc-400 border border-white/5 bg-white/5 hover:bg-white/10 hover:text-white transition-colors ml-1 h-7 w-7"
                title="Share article"
              >
                <Share2 className="h-3 w-3" />
              </button>

              {/* External link */}
              <a
                href={article.link}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="ml-1 flex items-center justify-center rounded p-0.5 text-zinc-500 border border-white/5 bg-white/5 hover:bg-white/10 hover:text-white transition-colors h-7 w-7"
                aria-label="Open in new tab"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        </CardContent>
      </Card>

    </>
  )
}
