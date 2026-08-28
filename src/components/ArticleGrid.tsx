import { ArticleCard } from "@/components/ArticleCard"

export interface ArticleRow {
  id: string
  feedId: string | null
  title: string
  description: string | null
  link: string
  image: string | null
  publishedAt: Date | string | null
  isUsed: boolean | null
  visitCount: number | null
  isBookmarked: boolean | null
  isReadLater: boolean | null
  isFavorite: boolean | null
  createdAt?: Date | string | null
  // enriched
  feedName?: string
  domain?: string
}

interface ArticleGridProps {
  articles: Array<ArticleRow>
  title: string
  /** Optional folderId used when refreshing a folder's feeds */
  folderId?: string
  /** Replaces the "no articles" line. Used to put the catalogue on an empty workspace. */
  emptyState?: React.ReactNode
  onRefreshed: () => void
}

export function ArticleGrid({
  articles,
  title,
  emptyState,
  onRefreshed,
}: ArticleGridProps) {
  return (
    <div className="flex min-h-screen flex-1 flex-col bg-[#0a0a0a]">
      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-5">
        {articles.length === 0 ? (
          emptyState ?? (
            <div className="flex h-64 flex-col items-center justify-center gap-3">
              <p className="text-sm text-zinc-600">
                No articles in {title}.
              </p>
            </div>
          )
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {articles.map((article) => (
              <ArticleCard
                key={article.id}
                article={article}
                onUpdate={onRefreshed}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
