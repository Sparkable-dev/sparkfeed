import { ExternalLink } from "lucide-react"
import type { PreviewArticle } from "@/server/services/catalogue-preview"
import { ArticleThumb } from "@/components/ArticleThumb"
import { domainOf } from "@/lib/source-mark"

/**
 * One article inside a Discover preview.
 *
 * A deliberately separate component from `ArticleCard`, which is built around a
 * persisted row: it keys favourites off `article.id`, writes to the server on
 * the heart, uses the id as a DOM id, and mounts a reader sheet that fetches by
 * id and throws for anything it cannot find. A catalogue article has no id and
 * never will, so reusing it would mean disabling four features and threading a
 * flag down through two more components.
 *
 * This one only reads. Clicking opens the publisher's page, because the point of
 * a preview is to judge a source, not to start a reading session in it.
 */

function formatDate(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

/**
 * The compact form, used in the preview dialog.
 *
 * A list rather than a carousel here. The dialog exists to answer "is this
 * source any good", which is a scanning task: six headlines in a column answer
 * it at a glance, where six cards in a row need a wide modal and a horizontal
 * drag to see past the third. The carousel stays on the category page, where
 * the width is real and browsing is the point.
 */
export function CatalogueArticleRow({ article }: { article: PreviewArticle }) {
  const date = formatDate(article.publishedAt)

  return (
    <a
      href={article.link}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-start gap-3 rounded-lg px-2 py-2 transition-colors
        hover:bg-accent dark:hover:bg-white/[0.04] focus-visible:bg-muted dark:focus-visible:bg-white/[0.04] focus-visible:outline-none"
    >
      <div className="size-12 shrink-0">
        <ArticleThumb
          src={article.image}
          link={article.link}
          scale="sm"
          className="rounded-md"
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="line-clamp-2 text-[13px] leading-snug font-medium text-foreground dark:text-zinc-200 transition-colors group-hover:text-foreground dark:group-hover:text-white">
          {article.title}
        </span>
        <span className="text-[11px] text-muted-foreground dark:text-zinc-600">{date}</span>
      </div>

      <ExternalLink className="mt-1 size-3 shrink-0 text-muted-foreground dark:text-zinc-700 opacity-0 transition-opacity group-hover:opacity-100" />
    </a>
  )
}

export function CatalogueArticleCard({ article }: { article: PreviewArticle }) {
  const date = formatDate(article.publishedAt)

  return (
    <a
      href={article.link}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex w-[220px] shrink-0 snap-start flex-col overflow-hidden rounded-lg border
        border-border dark:border-white/5 bg-card dark:bg-[#161616] transition-all duration-300 hover:-translate-y-0.5
        hover:border-border dark:hover:border-white/15 hover:shadow-xl focus-visible:ring-2 focus-visible:ring-ring dark:focus-visible:ring-white/30
        focus-visible:outline-none"
    >
      <div
        className="relative w-full shrink-0 overflow-hidden"
        style={{ aspectRatio: "16/9" }}
      >
        <ArticleThumb
          src={article.image}
          link={article.link}
          className="transition-transform duration-500 group-hover:scale-105"
        />
        <span
          className="absolute right-2 bottom-2 z-10 flex size-6 items-center justify-center
            rounded-full border border-border dark:border-white/10 bg-card dark:bg-black/50 text-foreground dark:text-white/80 opacity-0 backdrop-blur-md
            transition-opacity group-hover:opacity-100"
        >
          <ExternalLink className="size-3" />
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <span className="text-[10px] font-medium tracking-wide text-muted-foreground dark:text-zinc-500 uppercase">
          {date || domainOf(article.link)}
        </span>
        <span className="line-clamp-3 text-xs leading-snug font-semibold text-foreground dark:text-zinc-100">
          {article.title}
        </span>
      </div>
    </a>
  )
}
