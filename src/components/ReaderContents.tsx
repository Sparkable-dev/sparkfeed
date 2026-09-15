import { useEffect, useRef, useState } from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { X } from "lucide-react"
import type { CSSProperties } from "react"
import type { ReaderHeading } from "@/hooks/use-reader-contents"
import type { ReaderTheme } from "@/store/readerPrefs"
import {
  READER_PROGRESS_STEPS,
  readerContentsLayout,
} from "@/hooks/use-reader-contents"
import {
  Dialog,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

interface ReaderContentsProps {
  headings: Array<ReaderHeading>
  progress: number
  progressTitles: Array<string>
  navigateProgress: (progress: number) => void
  activeIndex: number
  gutter: number
  height: number
  centerY: number
  mobile: boolean
  isLong: boolean
  zenMode: boolean
  theme: ReaderTheme
  navigate: (index: number) => void
}

export function ReaderContents(props: ReaderContentsProps) {
  const {
    headings,
    progress,
    progressTitles,
    navigateProgress,
    activeIndex,
    gutter,
    height,
    centerY,
    mobile,
    isLong,
    zenMode,
    theme,
    navigate,
  } = props
  const layout = readerContentsLayout(
    headings.length - 1,
    mobile,
    zenMode,
    isLong,
    gutter
  )
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const marksRef = useRef<HTMLDivElement>(null)
  const overlayListRef = useRef<HTMLDivElement>(null)
  const pendingNavigation = useRef<number | null>(null)
  const markHeight = Math.min(height * 0.6, Math.max(80, headings.length * 16))
  const overlayHeight = Math.min(height * 0.7, 480)

  useEffect(() => {
    if (marksRef.current) {
      marksRef.current.scrollTo({ top: activeIndex * 16, behavior: "instant" })
    }
  }, [activeIndex, layout, markHeight, zenMode])

  useEffect(() => {
    if (layout !== "mobile") setOpen(false)
  }, [layout])

  useEffect(() => {
    if (open || pendingNavigation.current === null) return
    const index = pendingNavigation.current
    pendingNavigation.current = null
    const frame = requestAnimationFrame(() => navigate(index))
    return () => cancelAnimationFrame(frame)
  }, [open, navigate])

  if (layout === "hidden") return null

  const marks = headings.map((heading, index) => (
    <span
      key={heading.key}
      className="reader-contents-mark-row"
      data-current={index === activeIndex || undefined}
    >
      <span className="reader-contents-mark" />
    </span>
  ))

  return (
    <>
      <nav
        aria-label="Article contents"
        className="reader-contents"
        data-layout={layout}
        style={
          {
            "--contents-gutter": `${gutter}px`,
            "--contents-window": `${markHeight}px`,
          } as CSSProperties
        }
        onMouseLeave={() => setPreview(null)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setPreview(null)
        }}
      >
        {zenMode && layout === "compact" ? (
          <div className="reader-zen-progress">
            <span
              className="sr-only"
              role="progressbar"
              aria-label="Article reading progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
            />
            {Array.from({ length: READER_PROGRESS_STEPS + 1 }, (_, index) => {
              const fraction = index / READER_PROGRESS_STEPS
              const title = progressTitles[index] ?? "Introduction"
              const label = `${Math.round(fraction * 100)}% · ${title}`
              return (
                <button
                  key={index}
                  className="reader-contents-mark-row"
                  data-current={
                    index === Math.round(progress * READER_PROGRESS_STEPS) ||
                    undefined
                  }
                  data-read={fraction < progress || undefined}
                  aria-label={label}
                  onClick={() => navigateProgress(fraction)}
                  onMouseEnter={() => setPreview(title)}
                  onFocus={() => setPreview(title)}
                >
                  <span className="reader-contents-mark" aria-hidden="true" />
                </button>
              )
            })}
          </div>
        ) : layout === "expanded" ? (
          <div className="reader-contents-label-window">
            <div
              className="reader-contents-label-track"
              style={{
                transform: `translateY(${-(activeIndex + 0.5) * 48}px)`,
              }}
            >
              {headings.map((heading, index) => (
                <button
                  key={heading.key}
                  className="reader-contents-label"
                  data-current={index === activeIndex || undefined}
                  data-visible={Math.abs(index - activeIndex) <= 2 || undefined}
                  tabIndex={Math.abs(index - activeIndex) <= 2 ? 0 : -1}
                  aria-hidden={Math.abs(index - activeIndex) > 2 || undefined}
                  aria-current={index === activeIndex ? "location" : undefined}
                  onClick={() => navigate(index)}
                  onMouseEnter={() => setPreview(heading.title)}
                  onFocus={() => setPreview(heading.title)}
                >
                  <span className="reader-contents-mark" aria-hidden="true" />
                  <span className="reader-contents-label-text">
                    {heading.title}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : layout === "compact" ? (
          <div ref={marksRef} className="reader-contents-marks">
            {headings.map((heading, index) => (
              <button
                key={heading.key}
                className="reader-contents-mark-row"
                data-current={index === activeIndex || undefined}
                aria-label={heading.title}
                aria-current={index === activeIndex ? "location" : undefined}
                onClick={() => navigate(index)}
                onMouseEnter={() => setPreview(heading.title)}
                onFocus={() => setPreview(heading.title)}
              >
                <span className="reader-contents-mark" aria-hidden="true" />
              </button>
            ))}
          </div>
        ) : (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger
              className="reader-contents-mobile-trigger"
              aria-label={`Open article contents. Current section: ${headings[activeIndex]?.title ?? "Introduction"}`}
            >
              <span
                className="reader-contents-mobile-window"
                aria-hidden="true"
              >
                <span
                  className="reader-contents-mobile-track"
                  style={{
                    transform: `translateY(${-(activeIndex + 0.5) * 16}px)`,
                  }}
                >
                  {marks}
                </span>
              </span>
            </DialogTrigger>
            <DialogPortal>
              <DialogOverlay
                forceRender
                className="reader-contents-backdrop"
                data-reader-theme={theme}
              />
              <DialogPrimitive.Popup
                className="reader-surface reader-contents-dialog"
                data-reader-theme={theme}
                style={
                  {
                    "--contents-window": `${overlayHeight}px`,
                    top: centerY,
                  } as CSSProperties
                }
                initialFocus={() => {
                  const list = overlayListRef.current
                  if (list) list.scrollTop = activeIndex * 48
                  return (
                    list?.querySelector<HTMLElement>(
                      '[aria-current="location"]'
                    ) ?? false
                  )
                }}
              >
                <DialogTitle className="sr-only">Article contents</DialogTitle>
                <DialogPrimitive.Close
                  className="reader-contents-close"
                  aria-label="Close article contents"
                >
                  <X size={18} />
                </DialogPrimitive.Close>
                <div
                  ref={overlayListRef}
                  className="reader-contents-dialog-list"
                >
                  {headings.map((heading, index) => (
                    <button
                      key={heading.key}
                      className="reader-contents-label"
                      data-current={index === activeIndex || undefined}
                      data-visible
                      aria-current={
                        index === activeIndex ? "location" : undefined
                      }
                      onClick={() => {
                        pendingNavigation.current = index
                        setOpen(false)
                      }}
                    >
                      <span
                        className="reader-contents-mark"
                        aria-hidden="true"
                      />
                      <span className="reader-contents-label-text">
                        {heading.title}
                      </span>
                    </button>
                  ))}
                </div>
              </DialogPrimitive.Popup>
            </DialogPortal>
          </Dialog>
        )}
        {preview && layout !== "mobile" && (
          <div className="reader-contents-tooltip" role="tooltip">
            {preview}
          </div>
        )}
      </nav>
    </>
  )
}
