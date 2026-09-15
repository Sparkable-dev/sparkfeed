import { useEffect, useRef, useState } from "react"

/**
 * A sticky strip of category names.
 *
 * Fifteen categories is roughly 2,700px of page before the last row. The
 * carousels shortened each row but did nothing about the number of rows, so
 * without this the breadth reads as a slog rather than as the point. It also
 * doubles as a table of contents: you can see the whole catalogue's shape
 * before scrolling any of it.
 *
 * **Render it outside the page's centred container.** It spans the full content
 * width and centres the chips itself, because a pinned bar that stops short of
 * the edges reads as a stray horizontal rule rather than a toolbar.
 *
 * Chrome appears only once it pins. Sitting in the page flow it is just chips;
 * the border and backdrop are there to separate it from content sliding beneath,
 * which is a job that does not exist until it is actually pinned.
 *
 * Two modes. On the catalogue page it observes the sections and scrolls to
 * them; on a category page there are no sections to observe, so the caller
 * passes `activeSlug` and `onSelect` and the chips navigate instead.
 */
export function CategoryNav({
  categories,
  activeSlug,
  onSelect,
  containerClassName = "max-w-6xl",
}: {
  categories: Array<{ slug: string; name: string }>
  /** Set on a per-category page, where nothing on screen can be observed. */
  activeSlug?: string
  /** Set to navigate rather than scroll. */
  onSelect?: (slug: string) => void
  /** Must match the page's own container, or the chips sit off-axis. */
  containerClassName?: string
}) {
  const [observed, setObserved] = useState<string | null>(categories[0]?.slug ?? null)
  const [stuck, setStuck] = useState(false)
  const strip = useRef<HTMLDivElement>(null)
  const sentinel = useRef<HTMLDivElement>(null)

  const active = activeSlug ?? observed
  const scrollMode = !onSelect

  /**
   * Highlights the last row to have passed under the bar.
   *
   * Computed on scroll rather than watched with an IntersectionObserver. The
   * observer version needed a detection band, and a band has two ends that
   * nothing can satisfy: at the very top of the page the first row has not
   * reached it yet, and at the very bottom a short final row runs out of page
   * before it gets there. Both left the previous chip lit — scroll down and back
   * and "Business & Finance" stayed highlighted above the AI row.
   *
   * Reading fifteen rects is cheap and, unlike a band, has a defined answer at
   * every scroll position.
   */
  useEffect(() => {
    if (!scrollMode) return

    let frame = 0
    const compute = () => {
      frame = 0
      const doc = document.documentElement

      // Anything above this line is behind the pinned bar, so it counts as read.
      const line = 64
      let current = categories[0]?.slug ?? null
      for (const c of categories) {
        const el = document.getElementById(`category-${c.slug}`)
        if (el && el.getBoundingClientRect().top <= line) current = c.slug
      }

      // The final row is often too short to ever reach the line.
      if (doc.scrollTop + window.innerHeight >= doc.scrollHeight - 2) {
        current = categories[categories.length - 1]?.slug ?? current
      }

      setObserved(current)
    }

    // Coalesce to one read per frame; scroll fires far more often than that.
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(compute)
    }

    compute()
    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
    }
  }, [categories, scrollMode])

  /**
   * Keeps the active chip visible as the page scrolls past categories.
   *
   * Sets scrollLeft directly rather than calling scrollIntoView. Even with
   * `block: "nearest"`, scrollIntoView is free to scroll ancestors vertically —
   * so the strip would yank the page back while the user was still travelling
   * to the section they had just clicked, and the jump appeared not to work at
   * all. Moving the strip's own scrollLeft cannot touch the page.
   */
  useEffect(() => {
    const el = strip.current
    if (!active || !el) return
    const chip = el.querySelector<HTMLElement>(`[data-slug="${active}"]`)
    if (!chip) return

    const left = chip.offsetLeft
    const right = left + chip.offsetWidth
    if (left < el.scrollLeft) {
      el.scrollLeft = left - 12
    } else if (right > el.scrollLeft + el.clientWidth) {
      el.scrollLeft = right - el.clientWidth + 12
    }
  }, [active])

  /**
   * Watches a zero-height marker sitting just above the bar.
   *
   * `position: sticky` gives no state of its own, so the marker scrolling out
   * from under the top bar is the proxy for "pinned". `rootMargin` pulls the
   * detection line down by the bar's 48px so it flips exactly as the strip
   * reaches it rather than 48px early.
   */
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => setStuck(!entry.isIntersecting),
      { rootMargin: "-48px 0px 0px 0px", threshold: 0 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const select = (slug: string) => {
    if (onSelect) {
      onSelect(slug)
      return
    }
    const el = document.getElementById(`category-${slug}`)
    if (!el) return
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" })
  }

  return (
    <>
      {/* Zero-height marker: the only way to know the bar has pinned. */}
      <div ref={sentinel} aria-hidden="true" className="h-px" />

      {/*
        `top-12` clears the 48px top bar, which is itself sticky at 0. This only
        holds because nothing between here and the document sets an overflow —
        see the note on RSSShell's content slot, which used to be
        `overflow-hidden` and quietly disabled every sticky element beneath it.
      */}
      <div
        className={`sticky top-12 z-20 mb-8 border-b transition-colors duration-200 ${
          stuck
            ? "border-border dark:border-zinc-800/60 bg-card dark:bg-[#0a0a0a]/95 backdrop-blur-sm"
            : "border-transparent"
        }`}
      >
        <div className={`mx-auto w-full min-w-0 px-6 py-2 ${containerClassName}`}>
          <div
            ref={strip}
            /*
              The edge fade is not decoration. Scrolled mid-strip, a chip sliced
              by the overflow sits flush against the container edge and reads as
              a collision; fading it out says "there is more this way" instead.
            */
            className="flex min-w-0 gap-1 overflow-x-auto
              [mask-image:linear-gradient(to_right,transparent,black_10px,black_calc(100%-16px),transparent)]
              [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {categories.map((c) => (
              <button
                key={c.slug}
                type="button"
                data-slug={c.slug}
                onClick={() => select(c.slug)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                  active === c.slug
                    ? "bg-primary dark:bg-white text-primary-foreground dark:text-black"
                    : "text-muted-foreground dark:text-zinc-400 hover:bg-accent dark:hover:bg-white/5 hover:text-foreground dark:hover:text-zinc-100"
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
