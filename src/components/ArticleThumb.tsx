import { useCallback, useEffect, useState } from "react"
import { domainOf, sourceMark } from "@/lib/source-mark"

/**
 * An article's image, or its source's mark when there isn't one.
 *
 * Every card in the app renders a thumbnail and, before this, every card
 * handled a missing one differently: pastel blocks keyed on list index in
 * `ArticleCard`, a hashed gradient in the Discover cards, nothing at all in the
 * reader panels. Worse, the three that did have a fallback only reached it via
 * `onError`, so an image that never resolved sat there as a torn-icon glyph
 * indefinitely, which is what a missing thumbnail actually looked like most of
 * the time.
 *
 * This decides up front. No `src` means the mark renders immediately; a `src`
 * that fails swaps to the same mark. There is no state in which a broken image
 * is what the user sees.
 *
 * Fills its parent, which owns the aspect ratio and the rounding.
 */
export function ArticleThumb({
  src,
  link,
  name,
  scale = "md",
  className = "",
}: {
  src: string | null | undefined
  /** The article's URL. Its host is the key, so a source looks the same everywhere. */
  link: string
  /** Feed name when known. Falls back to the domain, never to nothing. */
  name?: string | null
  /**
   * How much room the fallback has for words.
   *
   * `sm` is the only size that shows initials, because a 48px square cannot
   * hold a name. Everywhere else spells the source out: "OB" is not a
   * recognisable abbreviation and there is nowhere for a reader to learn what
   * it stands for, so it reads as a rendering artefact rather than as a label.
   */
  scale?: "sm" | "md" | "lg"
  className?: string
}) {
  const [failed, setFailed] = useState(false)

  /*
    Without this, recycling the component onto a new article keeps the previous
    one's failure: the carousel's second story would inherit the first's broken
    flag and show a mark it did not need.
  */
  useEffect(() => setFailed(false), [src])

  /**
   * Catches the failure `onError` cannot see.
   *
   * The page is server-rendered, so the browser starts fetching these images
   * from the initial HTML, well before React hydrates. An image that fails in
   * that window has already fired its one `error` event by the time the
   * handler is attached, and React never hears about it — which left a torn
   * glyph sitting on top of the fallback rather than instead of it. This was
   * the actual reason so many cards looked broken.
   *
   * `complete && naturalWidth === 0` is the only way to ask after the fact: a
   * decoded image always reports a width, and one still loading is not
   * complete.
   */
  const catchPreHydrationFailure = useCallback((node: HTMLImageElement | null) => {
    if (node?.complete && node.naturalWidth === 0) setFailed(true)
  }, [])

  const domain = domainOf(link)
  const mark = sourceMark(domain || link, name)

  return (
    <div
      className={`relative size-full overflow-hidden ${className}`}
      style={{ background: mark.surface }}
    >
      {src && !failed ? (
        <img
          // Remounts on a new story, so the ref check below runs against it.
          key={src}
          ref={catchPreHydrationFailure}
          src={src}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className={`absolute inset-0 flex items-center justify-center px-3 text-center font-semibold
            tracking-tight text-balance text-white/30 select-none ${
              scale === "sm" ? "text-xs" : scale === "lg" ? "text-xl" : "text-sm"
            }`}
        >
          {/* A long feed name has to stop somewhere rather than fill the tile. */}
          <span className="line-clamp-3">
            {scale === "sm" ? mark.initials : mark.label}
          </span>
        </span>
      )}
    </div>
  )
}
