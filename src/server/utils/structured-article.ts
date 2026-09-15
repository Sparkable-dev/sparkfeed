import type { parseHTML } from "linkedom"

type Document = ReturnType<typeof parseHTML>["document"]
type RecordValue = Record<string, unknown>

function record(value: unknown): RecordValue | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : null
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function escapeText(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!
  )
}

/** Only publisher-provided articleBody counts as content, never a description. */
export function structuredArticle(document: Document, baseUrl: string) {
  const candidates: Array<RecordValue> = []
  for (const script of document.querySelectorAll(
    'script[type="application/ld+json"]'
  )) {
    let data: unknown
    try {
      data = JSON.parse(script.textContent)
    } catch {
      continue
    }
    const queue = [data]
    for (let index = 0; index < queue.length && index < 2000; index++) {
      const value = queue[index]
      if (Array.isArray(value)) {
        queue.push(...value)
        continue
      }
      const item = record(value)
      if (!item) continue
      const types = Array.isArray(item["@type"])
        ? item["@type"]
        : [item["@type"]]
      if (
        types.some(
          (type) =>
            typeof type === "string" &&
            /^(Article|NewsArticle|BlogPosting|TechArticle|Report|ScholarlyArticle)$/.test(
              type
            )
        ) &&
        text(item.articleBody)
      )
        candidates.push(item)
      queue.push(...Object.values(item))
    }
  }
  const matchesUrl = (candidate: RecordValue) => {
    const raw =
      text(candidate.url) ||
      text(record(candidate.mainEntityOfPage)?.["@id"]) ||
      text(candidate.mainEntityOfPage) ||
      text(candidate["@id"])
    if (!raw) return candidates.length === 1
    try {
      const url = new URL(raw, baseUrl)
      const source = new URL(baseUrl)
      return (
        url.origin === source.origin &&
        url.search === source.search &&
        url.pathname.replace(/\/$/, "") === source.pathname.replace(/\/$/, "")
      )
    } catch {
      return false
    }
  }
  const candidate = candidates.find(matchesUrl)
  const body = text(candidate?.articleBody)
  if (!candidate || !body || body.length < 200 || body.length > 1_000_000)
    return null
  const content =
    /<(?:p|div|section|h[1-6]|ul|ol|blockquote|table|figure|img|br)\b/i.test(
      body
    )
      ? body
      : body
          .split(/\n+/)
          .map((paragraph) => `<p>${escapeText(paragraph)}</p>`)
          .join("")
  const authors = Array.isArray(candidate.author)
    ? candidate.author
    : [candidate.author]
  const byline =
    authors
      .map((author) => text(author) || text(record(author)?.name))
      .filter(Boolean)
      .join(", ") || null
  const rawImage = Array.isArray(candidate.image)
    ? candidate.image[0]
    : candidate.image
  let image =
    text(rawImage) ||
    text(record(rawImage)?.url) ||
    text(record(rawImage)?.contentUrl)
  try {
    const url = new URL(image ?? "", baseUrl)
    image =
      image && /^https?:$/.test(url.protocol) && !url.username && !url.password
        ? url.href
        : null
  } catch {
    image = null
  }
  return {
    content,
    title: text(candidate.headline) || text(candidate.name),
    byline,
    image,
    excerpt: text(candidate.description),
  }
}
