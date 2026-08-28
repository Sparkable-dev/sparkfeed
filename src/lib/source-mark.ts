/**
 * One visual identity per source, for everywhere an image is missing.
 *
 * Roughly one article in five arrives without a usable image, and a source's
 * favicon is missing about as often, so "no image" is a normal state rather
 * than an error and has to look deliberate. Three rules make the difference
 * between designed and broken:
 *
 *  - **The key is the source, never the item.** Every article from
 *    blog.hubspot.com gets the same mark, on Home, in a folder, in Discover.
 *    That turns a missing image into a recognisable tile instead of noise, and
 *    it is why this takes a domain rather than a link.
 *  - **The key is hashed, never indexed.** `ArticleCard` used to pick
 *    `PASTEL_COLORS[index % 6]`, so a card changed colour whenever the list
 *    reordered and the page appeared to flicker on every refresh.
 *  - **Two intensities from one hue.** A vivid gradient is right for a 40px
 *    icon and far too loud across a 4:3 card, but they must be visibly the same
 *    family or the icon and the thumbnail stop looking like one source.
 *
 * This replaced three separate implementations of the same idea, each with its
 * own copy of the hash: `SourceIcon`, `CatalogueArticleCard`, and the pastels
 * in `ArticleCard`.
 */

/** Paired vivid/muted stops, same hue, checked against #0a0a0a and #161616. */
const HUES: Array<{ vivid: [string, string]; muted: [string, string] }> = [
  { vivid: ["#8b5cf6", "#4338ca"], muted: ["#2a1f47", "#1b1b3a"] },
  { vivid: ["#0ea5e9", "#1d4ed8"], muted: ["#12293f", "#141f4a"] },
  { vivid: ["#10b981", "#0f766e"], muted: ["#10322a", "#0f2a2a"] },
  { vivid: ["#f59e0b", "#c2410c"], muted: ["#3a2a12", "#33200f"] },
  { vivid: ["#f43f5e", "#be185d"], muted: ["#3a1826", "#331028"] },
  { vivid: ["#d946ef", "#7e22ce"], muted: ["#331240", "#2a1440"] },
  { vivid: ["#06b6d4", "#0369a1"], muted: ["#0c2b36", "#0b2438"] },
  { vivid: ["#84cc16", "#15803d"], muted: ["#22300f", "#12261a"] },
]

/** FNV-1a. Small, stable, and independent of anything about the list. */
function hash(value: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return Math.abs(h)
}

const SKIP = new Set(["the", "a", "an", "of", "on", "in", "and", "for"])

/** "The Verge" is TV, not TT. */
export function initials(name: string): string {
  const words = name
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !SKIP.has(w.toLowerCase()))
  if (words.length === 0) return name.slice(0, 2).toUpperCase()
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/**
 * The registrable-looking part of a host, for when there is no feed name.
 *
 * "blog.hubspot.com" is HubSpot, not Blog, so the leading label is dropped
 * whenever there is something more specific behind it. `split` always yields at
 * least one element, so both branches are total.
 */
export function sourceLabel(domain: string): string {
  const parts = domain.replace(/^www\./, "").split(".")
  return parts.length > 2 ? parts[1] : parts[0]
}

/** A source's display domain, or "" when the link is unparseable. */
export function domainOf(url: string | null | undefined): string {
  if (!url) return ""
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return ""
  }
}

export interface SourceMark {
  /** For a large area sitting behind or instead of content. */
  surface: string
  /** For a small mark that should read as a logo. */
  icon: string
  /**
   * Two letters, for marks too small to hold a word — a 40px icon, a 48px
   * list thumbnail. Anywhere with room should prefer `label`: "OB" is not a
   * recognisable abbreviation of anything, and a reader has no way to learn it.
   */
  initials: string
  /** The source's name as a person would say it. "OpenAI Blog", "aws.amazon.com". */
  label: string
}

/**
 * @param key   Stable per source. A domain, a catalogue slug, a feed id.
 * @param name  The source's name. Falls back to the key when absent, which for
 *              a thumbnail means the domain — still readable, unlike a slug.
 */
export function sourceMark(key: string, name?: string | null): SourceMark {
  const hue = HUES[hash(key) % HUES.length]
  const label = name?.trim() || key
  return {
    surface: `linear-gradient(135deg, ${hue.muted[0]}, ${hue.muted[1]})`,
    icon: `linear-gradient(135deg, ${hue.vivid[0]}, ${hue.vivid[1]})`,
    initials: initials(name?.trim() || sourceLabel(key)),
    label,
  }
}
