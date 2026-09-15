import { describe, expect, it } from "vitest"
import {
  extractReadable,
  readerContentEndsAtHeading,
  sanitizeArticleHtml,
} from "../extract"

const paragraph =
  "This is a detailed explanation of the evaluation process, including the people involved, the checks they perform, and the records they retain. Each stage has a different purpose, so the entire article must remain readable when a diagram separates its sections."
const page = (body: string) =>
  `<html><head><title>Evaluation process</title></head><body><nav>Menu</nav><main>${body}</main><footer>Footer links</footer></body></html>`

describe("reader extraction across media blocks", () => {
  it("recovers split layout sections, SVG diagrams, and text after the image", () => {
    const result = extractReadable(
      page(`
      <section><div class="grid"><div class="rich-text">${`<p>${paragraph}</p>`.repeat(5)}<h2>The next stage</h2></div></div></section>
      <section id="diagram"><div class="grid"><div><img class="light-mode" alt="Evaluation diagram" src="/diagram.svg"><img class="dark-mode-alternative" alt="Evaluation diagram" src="/diagram-dark.svg"></div></div></section>
      <section><div class="grid"><div class="rich-text"><p>Continuation after the diagram. ${paragraph}</p><blockquote>A testimonial belongs to the article, even when it is between layout sections.</blockquote><p>Read the final technical report for the remaining details. ${paragraph}</p></div></div></section>
    `),
      "https://example.com/article"
    )
    expect(result?.contentHtml).toContain("Continuation after the diagram")
    expect(result?.contentHtml).toContain("final technical report")
    expect(result?.contentHtml).toContain("A testimonial belongs")
    expect(result?.contentHtml).toContain(
      'src="https://example.com/diagram.svg"'
    )
    expect(result?.contentHtml).toContain('data-reader-image-theme="dark"')
    expect(result?.contentHtml).toContain('id="diagram"')
    expect(result?.contentHtml).not.toContain("Footer links")
    expect(readerContentEndsAtHeading(result!.contentHtml)).toBe(false)
  })

  it("recognizes a dangling heading but accepts a following image or paragraph", () => {
    expect(
      readerContentEndsAtHeading(
        "<div><p>Body</p><h2><span>Next section</span></h2></div>"
      )
    ).toBe(true)
    expect(
      readerContentEndsAtHeading('<h2>Diagram</h2><img src="/image.png">')
    ).toBe(false)
    expect(
      readerContentEndsAtHeading("<h2>Next section</h2><p>Continued.</p>")
    ).toBe(false)
  })

  it("keeps ordinary complete articles intact", () => {
    const result = extractReadable(
      page(
        `<article><h1>Evaluation process</h1><p>${paragraph}</p><h2>Final section</h2><p>${paragraph}</p></article>`
      ),
      "https://example.com/article"
    )
    expect(result?.contentHtml).toContain("Final section")
    expect(result?.contentHtml).toContain(paragraph)
    expect(readerContentEndsAtHeading(result!.contentHtml)).toBe(false)
  })
})

describe("sanitized article media", () => {
  it("resolves lazy SVG and responsive picture URLs", () => {
    const result = sanitizeArticleHtml(
      '<picture><source data-srcset="/large.webp 2x"><img data-src="/diagram.svg" src="data:image/gif;base64,R0l" data-srcset="/small.webp 1x, /large.webp 2x" alt="Diagram"></picture>',
      "https://example.com/article"
    )
    expect(result).toContain('src="https://example.com/diagram.svg"')
    expect(result).toContain(
      'srcset="https://example.com/small.webp 1x, https://example.com/large.webp 2x"'
    )
    expect(result).toContain('srcset="https://example.com/large.webp 2x"')
  })

  it("keeps audio/video controls, captions, and subsequent text without autoplay or executable content", () => {
    const result = sanitizeArticleHtml(
      '<video autoplay onerror="evil()" poster="/poster.jpg"><source src="/clip.mp4"><track src="/captions.vtt" kind="captions"></video><audio autoplay src="/voice.mp3"></audio><p>After the player</p><script>evil()</script><img src="javascript:evil()" onload="evil()">',
      "https://example.com/article"
    )
    expect(result).toContain("<video")
    expect(result).toContain("controls")
    expect(result).toContain('preload="none"')
    expect(result).toContain('src="https://example.com/voice.mp3"')
    expect(result).toContain('src="https://example.com/captions.vtt"')
    expect(result).toContain("After the player")
    expect(result).not.toMatch(/autoplay|onerror|onload|javascript:|evil\(\)/)
  })

  it("replaces unsupported embeds with an original-page link and keeps the rest of the article", () => {
    const result = sanitizeArticleHtml(
      '<iframe src="https://video.example/embed"></iframe><p>Article continues.</p>',
      "https://example.com/article"
    )
    expect(result).not.toContain("<iframe")
    expect(result).toContain('href="https://example.com/article"')
    expect(result).toContain("View embedded media")
    expect(result).toContain("Article continues.")
    expect(readerContentEndsAtHeading("<h2>Video</h2>" + result)).toBe(false)
    expect(
      readerContentEndsAtHeading('<h2><a href="#video">Video</a></h2>')
    ).toBe(true)
  })
})

it("preserves complete saved bodies when a feed refresh supplies a teaser or dangling section", async () => {
  const { acceptFeedReaderContent } = await import("../extract")
  const saved = '<p>A complete saved account with all of the details, including its conclusion.</p>'
  expect(acceptFeedReaderContent('<p>Short teaser</p>', saved)).toBeNull()
  expect(acceptFeedReaderContent(`${saved}<h2>Missing section</h2>`, saved)).toBeNull()
  expect(acceptFeedReaderContent(`${saved}<p>Publisher correction with more detail.</p>`, saved)).toContain("Publisher correction")
  expect(acceptFeedReaderContent(saved, null)).toBe(saved)
})
