// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { buildReaderExport } from "./reader-export"

const input = {
  title: "Title",
  url: "https://example.com/story",
  html: "<p>Body</p>",
}
describe("Reader export", () => {
  it("keeps structure, nested lists, code language and whitespace", () => {
    const result = buildReaderExport({
      ...input,
      html: '<h2>Heading</h2><p><strong>Bold</strong> and <em>italic</em> <a href="/other">link</a></p><ol start="3"><li>One<ul><li>Nested</li></ul></li></ol><blockquote>Quote</blockquote><pre><code class="language-ts">const x = 1\n\n\n  y</code></pre>',
    })
    expect(result.markdown).toContain("## Heading")
    expect(result.markdown).toContain("**Bold**")
    expect(result.markdown).toContain("[link](https://example.com/other)")
    expect(result.markdown).toContain("3.")
    expect(result.markdown).toContain("Nested")
    expect(result.markdown).toContain("```ts\nconst x = 1\n\n\n  y")
  })
  it("preserves images and captions, resolves lazy URLs and deduplicates hero/title", () => {
    const result = buildReaderExport({
      ...input,
      image: "/image.png",
      html: '<h1>Title</h1><figure><img src="data:image/gif;base64,x" data-src="/image.png" alt="A diagram"><figcaption>Caption</figcaption></figure>',
    })
    expect(result.markdown.match(/# Title/g)).toHaveLength(1)
    expect(result.html.match(/<img/g)).toHaveLength(1)
    expect(result.markdown).toContain(
      "![A diagram](https://example.com/image.png)"
    )
    expect(result.markdown).toContain("Caption")
  })
  it("removes unsafe attributes, scripts and URLs without applying Reader themes", () => {
    const result = buildReaderExport({
      ...input,
      html: '<script>alert(1)</script><p style="color:white" onclick="bad()">Safe <a href="javascript:bad()">text</a><img src="/img" onerror="bad()"></p>',
    })
    expect(result.html).not.toMatch(/script|onclick|onerror|style=|javascript:/)
    expect(result.markdown).toContain("Safe text")
  })
  it("exports tables and degrades merged cells without losing content", () => {
    expect(
      buildReaderExport({
        ...input,
        html: "<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>",
      }).markdown
    ).toContain("| A | B |\n| --- | --- |")
    const result = buildReaderExport({
      ...input,
      html: '<table><tr><td colspan="2">Both</td></tr></table>',
    })
    expect(result.markdown).toContain("Row 1:\n- Both")
    expect(result.html).toContain('colspan="2"')
  })
  it("labels partial exports and ignores invalid publication dates", () => {
    const result = buildReaderExport({
      ...input,
      partial: true,
      publishedAt: "invalid",
    })
    expect(result.markdown).toContain("may be incomplete")
    expect(result.markdown).not.toContain("Published:")
  })
  it("rejects empty content and retains media fallback links", () => {
    expect(() => buildReaderExport({ ...input, html: " " })).toThrow()
    expect(
      buildReaderExport({ ...input, html: '<video src="/movie.mp4"></video>' })
        .markdown
    ).toContain("https://example.com/movie.mp4")
  })
})
