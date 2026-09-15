/** Recover responsive images once, then leave a readable fallback in the article. */
export function handleReaderMediaError(
  target: EventTarget | null,
  originalUrl: string
) {
  if (
    !(target instanceof HTMLElement) ||
    !/^(IMG|VIDEO|AUDIO)$/.test(target.tagName)
  )
    return
  if (target.dataset.readerMediaFailed) return
  const image = target instanceof HTMLImageElement ? target : null
  const picture = image?.closest("picture")
  if (
    image &&
    !image.dataset.readerMediaRetried &&
    image.getAttribute("src") &&
    (image.srcset || picture?.querySelector("source[srcset]"))
  ) {
    image.dataset.readerMediaRetried = "true"
    picture?.querySelectorAll("source").forEach((source) => source.remove())
    image.removeAttribute("srcset")
    // Also covers an already-failed fallback URL when the selected source changes.
    image.src = image.getAttribute("src")!
    return
  }
  target.dataset.readerMediaFailed = "true"
  target.hidden = true
  const fallback = document.createElement("p")
  fallback.className = "reader-media-fallback"
  fallback.dataset.readerMediaFallback = "true"
  const theme = target.getAttribute("data-reader-image-theme")
  if (theme) fallback.setAttribute("data-reader-image-theme", theme)
  const description = document.createElement("span")
  description.textContent = image
    ? image.alt.trim()
      ? `Image unavailable: ${image.alt.trim()}`
      : "Image unavailable."
    : "Media unavailable."
  const link = document.createElement("a")
  link.href = originalUrl
  link.target = "_blank"
  link.rel = "noopener noreferrer"
  link.textContent = "View on original page"
  fallback.append(description, document.createTextNode(" "), link)
  ;(picture ?? target).after(fallback)
}
