import { useState } from "react"
import { sourceMark } from "@/lib/source-mark"

/**
 * A source's mark: its real icon, or a gradient with its initials.
 *
 * Roughly one source in eight has no usable favicon, so the fallback is a
 * normal state rather than an error state and has to look deliberate. The hash,
 * the palette and the initials now come from `@/lib/source-mark`, shared with
 * `ArticleThumb` — a source's icon and its article thumbnails have to be the
 * same colour or they stop reading as the same source.
 *
 * What stays local is the ring. Without it a solid block reads as a placeholder
 * that failed to load; with it, it reads as a mark.
 */

export function SourceIcon({
  name,
  slug,
  file,
  accent,
  size = 40,
  className = "",
}: {
  name: string
  slug: string
  file?: string | null
  accent?: string | null
  size?: number
  className?: string
}) {
  const [failed, setFailed] = useState(false)

  const shell = `shrink-0 overflow-hidden rounded-lg ring-1 ring-white/10 ${className}`
  const box = { width: size, height: size }

  if (file && !failed) {
    return (
      <img
        src={`/catalogue/${file}`}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        // An icon deleted from the repo must degrade to the fallback, not
        // render a broken-image glyph.
        onError={() => setFailed(true)}
        /*
          And `onError` alone does not catch it. The page is server-rendered, so
          a missing icon fails while the HTML is still parsing and has fired its
          only error event before React attaches the handler above. Three
          catalogue icons were sitting as torn glyphs for exactly this reason.
          See the same check in `ArticleThumb`.
        */
        ref={(node) => {
          if (node?.complete && node.naturalWidth === 0) setFailed(true)
        }}
        className={`${shell} bg-white/5 object-cover`}
        style={box}
      />
    )
  }

  const mark = sourceMark(slug, name)

  return (
    <span
      aria-hidden="true"
      className={`${shell} flex items-center justify-center`}
      style={{
        ...box,
        background: accent
          ? `linear-gradient(135deg, ${accent}, ${accent}99)`
          : mark.icon,
        boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.12)",
      }}
    >
      <span
        className="font-semibold tracking-tight text-white/95 select-none"
        style={{ fontSize: Math.round(size * 0.36) }}
      >
        {mark.initials}
      </span>
    </span>
  )
}
