import { useCallback, useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"

/**
 * One horizontally scrolling row of catalogue cards.
 *
 * A row rather than a wrapping grid for three reasons: eight stacked grids is a
 * very long page, a one-column grid on a phone is fifty-odd cards in a vertical
 * stack, and a row cannot go ragged — a double-width collection card is just a
 * wider item rather than something that pushes a lone card onto its own line.
 *
 * The cards size themselves so the next one is deliberately cut off at the
 * right edge. That truncation is the affordance: a clean edge reads as "that is
 * everything", a sliced card reads as "keep going". With only five to eight
 * curated sources per category, anything hidden without a hint is curation
 * nobody ever sees.
 *
 * On touch there are no arrows — the swipe is the affordance. Arrows appear on
 * pointer devices only, and are a progressive enhancement over a scroller that
 * already works without them.
 */

/** How far one arrow press moves, as a fraction of the visible width. */
const PAGE_FRACTION = 0.8

export function CategoryRow({
  children,
  variant = "page",
}: {
  children: React.ReactNode
  /**
   * `page` bleeds to the viewport edge and hangs its arrows outside the row,
   * which only works inside the catalogue page's `px-6` container. `inset` is
   * for anywhere with its own clipping, a dialog above all: an arrow at
   * `-left-3` is simply invisible there.
   */
  variant?: "page" | "inset"
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(true)

  const measure = useCallback(() => {
    const el = scroller.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    setAtStart(el.scrollLeft <= 1)
    // Sub-pixel widths mean scrollLeft rarely reaches max exactly.
    setAtEnd(el.scrollLeft >= max - 1)
  }, [])

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    measure()
    el.addEventListener("scroll", measure, { passive: true })
    // Cards reflow at every breakpoint, so the ends move without a scroll event.
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => {
      el.removeEventListener("scroll", measure)
      observer.disconnect()
    }
  }, [measure])

  const page = (direction: -1 | 1) => {
    const el = scroller.current
    if (!el) return
    // Respect the OS setting. A smooth-scrolling carousel is exactly the kind
    // of motion people disable it for.
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    el.scrollBy({
      left: direction * el.clientWidth * PAGE_FRACTION,
      behavior: reduced ? "auto" : "smooth",
    })
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") {
      e.preventDefault()
      page(1)
    } else if (e.key === "ArrowLeft") {
      e.preventDefault()
      page(-1)
    }
  }

  const inset = variant === "inset"

  const arrow =
    "absolute top-1/2 z-10 hidden size-9 -translate-y-1/2 items-center justify-center rounded-full " +
    "border border-border dark:border-white/10 bg-card dark:bg-zinc-900/90 text-foreground dark:text-zinc-300 shadow-xl backdrop-blur-sm transition-all " +
    "hover:bg-accent dark:hover:bg-zinc-800 hover:text-foreground dark:hover:text-white disabled:pointer-events-none disabled:opacity-0 " +
    "md:flex md:opacity-0 md:group-hover/row:opacity-100 md:focus-visible:opacity-100"

  return (
    <div className="group/row relative min-w-0">
      <button
        type="button"
        aria-label="Scroll left"
        onClick={() => page(-1)}
        disabled={atStart}
        className={`${arrow} ${inset ? "left-1" : "-left-3"}`}
      >
        <ChevronLeft className="size-4" />
      </button>

      {/*
        tabIndex makes the row reachable without a mouse — a scroll container
        with no focusable wrapper is a keyboard dead end, which is the thing
        most carousels get wrong. The cards inside remain individually tabbable.
      */}
      <div
        ref={scroller}
        tabIndex={0}
        role="group"
        onKeyDown={onKeyDown}
        className={`flex w-full min-w-0 gap-4 overflow-x-auto scroll-smooth pb-1
          [scrollbar-width:none] focus-visible:outline-none [&::-webkit-scrollbar]:hidden ${
            inset
              ? // Proximity, not mandatory: a mandatory horizontal snap nested
                // inside a vertical scroller fights diagonal touch gestures.
                "snap-x snap-proximity"
              : "snap-x snap-mandatory -mx-6 px-6 sm:mx-0 sm:px-0"
          }`}
      >
        {children}
        {/* Lets the final card snap flush to the left edge instead of stopping short. */}
        <div aria-hidden="true" className="w-px shrink-0" />
      </div>

      <button
        type="button"
        aria-label="Scroll right"
        onClick={() => page(1)}
        disabled={atEnd}
        className={`${arrow} ${inset ? "right-1" : "-right-3"}`}
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  )
}
