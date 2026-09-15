import { useCallback, useEffect, useState } from "react"

export interface ReaderHeading {
  key: string
  title: string
  element: HTMLElement | null
}

export const READER_READING_LINE = 96
export const READER_PROGRESS_STEPS = 20

export function readerProgress(
  scrollTop: number,
  articleEnd: number,
  viewportHeight: number
) {
  const distance = Math.max(0, articleEnd - viewportHeight)
  return distance > 0 ? Math.min(1, Math.max(0, scrollTop / distance)) : 0
}

// Navigation uses element references, so duplicate publisher IDs and titles
// remain untouched and still lead to the correct section.
export function collectReaderHeadings(
  prose: HTMLElement
): Array<ReaderHeading> {
  const headings = Array.from(prose.querySelectorAll<HTMLElement>("h2, h3"))
    .filter((element) => !element.closest("[hidden], [aria-hidden='true']"))
    .map((element, index) => ({
      key: `section-${index}`,
      title: element.textContent?.replace(/\s+/g, " ").trim() ?? "",
      element,
    }))
    .filter((heading) => heading.title)
  return headings.length
    ? [
        { key: "introduction", title: "Introduction", element: null },
        ...headings,
      ]
    : []
}

export function currentReaderSection(
  offsets: Array<number>,
  scrollTop: number,
  viewportHeight: number,
  articleEnd: number
) {
  if (offsets.length === 0) return 0
  // A short, unscrolled article starts at Introduction, even if it fits onscreen.
  if (scrollTop > 0 && scrollTop + viewportHeight >= articleEnd - 2) {
    return offsets.length
  }
  let active = 0
  for (let i = 0; i < offsets.length; i++) {
    if (offsets[i] > scrollTop + READER_READING_LINE + 1) break
    active = i + 1
  }
  return active
}

export function readerContentsLayout(
  headingCount: number,
  mobile: boolean,
  zenMode: boolean,
  isLong: boolean,
  gutter: number
): "hidden" | "expanded" | "compact" | "mobile" {
  if (headingCount <= 0 || (zenMode && (mobile || !isLong))) return "hidden"
  if (mobile) return "mobile"
  return !zenMode && gutter >= 240 ? "expanded" : "compact"
}

export function useReaderContents(
  articleId: string,
  readerHtml?: string | null
) {
  const [scrollElement, scrollRef] = useState<HTMLDivElement | null>(null)
  const [articleElement, articleRef] = useState<HTMLDivElement | null>(null)
  const [proseElement, proseRef] = useState<HTMLDivElement | null>(null)
  const [headings, setHeadings] = useState<Array<ReaderHeading>>([])
  const [progressTitles, setProgressTitles] = useState<Array<string>>([])
  const [position, setPosition] = useState({
    activeIndex: 0,
    progress: 0,
    gutter: 0,
    mobile: false,
    isLong: false,
    height: 0,
    centerY: 0,
  })

  useEffect(() => {
    if (!scrollElement || !articleElement || !proseElement) {
      setHeadings([])
      return
    }
    let entries = collectReaderHeadings(proseElement)
    setHeadings(entries)
    let frame = 0
    let needsLayout = true
    let offsets: Array<number> = []
    let articleEnd = 0
    let gutter = 0
    let articleHeight = 0
    const measure = () => {
      frame = 0
      if (needsLayout) {
        const scrollRect = scrollElement.getBoundingClientRect()
        const articleRect = articleElement.getBoundingClientRect()
        const proseRect = proseElement.getBoundingClientRect()
        offsets = entries
          .slice(1)
          .map(
            ({ element }) =>
              element!.getBoundingClientRect().top -
              scrollRect.top +
              scrollElement.scrollTop
          )
        articleEnd = proseRect.bottom - scrollRect.top + scrollElement.scrollTop
        articleHeight = proseRect.bottom - articleRect.top
        gutter = articleRect.left - scrollRect.left
        const height = scrollElement.clientHeight
        const distance = Math.max(0, articleEnd - height)
        setProgressTitles(
          Array.from(
            { length: READER_PROGRESS_STEPS + 1 },
            (_, index) =>
              entries[
                currentReaderSection(
                  offsets,
                  (distance * index) / READER_PROGRESS_STEPS,
                  height,
                  articleEnd
                )
              ]?.title ?? "Introduction"
          )
        )
        needsLayout = false
      }
      const height = scrollElement.clientHeight
      const next = {
        progress:
          Math.round(
            readerProgress(scrollElement.scrollTop, articleEnd, height) * 1000
          ) / 1000,
        activeIndex: currentReaderSection(
          offsets,
          scrollElement.scrollTop,
          height,
          articleEnd
        ),
        gutter,
        height,
        centerY: scrollElement.getBoundingClientRect().top + height / 2,
        mobile: window.innerWidth < 768,
        isLong:
          entries.length >= 3 && height > 0 && articleHeight >= height * 3,
      }
      setPosition((previous) =>
        Object.keys(next).every(
          (key) =>
            previous[key as keyof typeof next] ===
            next[key as keyof typeof next]
        )
          ? previous
          : next
      )
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    const layout = () => {
      needsLayout = true
      schedule()
    }
    const resize = new ResizeObserver(layout)
    resize.observe(scrollElement)
    resize.observe(articleElement)
    resize.observe(proseElement)
    const mutation = new MutationObserver(() => {
      entries = collectReaderHeadings(proseElement)
      setHeadings(entries)
      layout()
    })
    mutation.observe(proseElement, {
      childList: true,
      subtree: true,
      characterData: true,
    })
    scrollElement.addEventListener("scroll", schedule, { passive: true })
    scrollElement.addEventListener("load", layout, true)
    window.addEventListener("resize", layout)
    measure()
    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      mutation.disconnect()
      scrollElement.removeEventListener("scroll", schedule)
      scrollElement.removeEventListener("load", layout, true)
      window.removeEventListener("resize", layout)
    }
  }, [scrollElement, articleElement, proseElement, articleId, readerHtml])

  const navigate = useCallback(
    (index: number) => {
      if (!scrollElement || !headings[index]) return
      const target = headings[index].element
      const top = target
        ? target.getBoundingClientRect().top -
          scrollElement.getBoundingClientRect().top +
          scrollElement.scrollTop -
          READER_READING_LINE
        : 0
      scrollElement.scrollTo({
        top: Math.max(0, top),
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      })
    },
    [scrollElement, headings]
  )

  const navigateProgress = useCallback(
    (progress: number) => {
      if (!scrollElement || !proseElement) return
      const articleEnd =
        proseElement.getBoundingClientRect().bottom -
        scrollElement.getBoundingClientRect().top +
        scrollElement.scrollTop
      scrollElement.scrollTo({
        top:
          Math.max(0, articleEnd - scrollElement.clientHeight) *
          Math.min(1, Math.max(0, progress)),
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      })
    },
    [scrollElement, proseElement]
  )

  return {
    scrollRef,
    articleRef,
    proseRef,
    headings,
    navigate,
    navigateProgress,
    progressTitles,
    ...position,
  }
}
