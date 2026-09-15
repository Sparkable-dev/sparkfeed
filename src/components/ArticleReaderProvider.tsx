import {
  Suspense,
  createContext,
  lazy,
  useContext,
  useMemo,
  useState,
} from "react"
import type { ArticleRow } from "./ArticleGrid"

const Preview = lazy(() =>
  import("./PreviewSheet").then((module) => ({ default: module.PreviewSheet }))
)
const Details = lazy(() =>
  import("./ArticleDetailsPanel").then((module) => ({
    default: module.ArticleDetailsPanel,
  }))
)
type Selection = { article: ArticleRow; view: "reader" | "details" } | null
const ReaderContext = createContext<{
  openReader: (article: ArticleRow) => void
  openDetails: (article: ArticleRow) => void
}>({ openReader: () => {}, openDetails: () => {} })
export function useArticleReader() {
  return useContext(ReaderContext)
}

export function ArticleReaderProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [selection, setSelection] = useState<Selection>(null)
  const actions = useMemo(
    () => ({
      openReader: (article: ArticleRow) =>
        setSelection({ article, view: "reader" }),
      openDetails: (article: ArticleRow) =>
        setSelection({ article, view: "details" }),
    }),
    []
  )
  return (
    <ReaderContext.Provider value={actions}>
      {children}
      {selection && (
        <Suspense
          fallback={
            <p
              role="status"
              className="fixed right-4 bottom-4 z-50 rounded-lg bg-card dark:bg-zinc-900 p-3 text-sm text-foreground dark:text-zinc-100"
            >
              Opening reader…
            </p>
          }
        >
          {selection.view === "reader" ? (
            <Preview
              key={selection.article.id}
              article={selection.article}
              onClose={() => setSelection(null)}
            />
          ) : (
            <Details
              article={selection.article}
              onClose={() => setSelection(null)}
              onRead={() => actions.openReader(selection.article)}
            />
          )}
        </Suspense>
      )}
    </ReaderContext.Provider>
  )
}
