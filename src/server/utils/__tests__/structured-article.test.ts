import { parseHTML } from "linkedom"
import { describe, expect, it } from "vitest"
import { structuredArticle } from "../structured-article"
import { extractReadable } from "../extract"

const url = "https://publisher.test/article"
const body =
  "A complete publisher-provided article with details about the subject and its implications. ".repeat(
    10
  )
const page = (value: unknown) =>
  `<html><head><title>Example</title><script type="application/ld+json">${JSON.stringify(value).replace(/</g, "\\u003c")}</script></head><body><div>Loading…</div></body></html>`

describe("structured article recovery", () => {
  it("recovers body and metadata from a JSON-LD graph when the page shell has no prose", () => {
    const html = page({
      "@graph": [
        { "@type": "WebSite", name: "Publisher" },
        {
          "@type": "NewsArticle",
          url,
          headline: "Real title",
          articleBody: body,
          author: [{ name: "Author" }],
          image: { url: "/cover.jpg" },
        },
      ],
    })
    const result = extractReadable(html, url)
    expect(result?.contentHtml).toContain(body.trim())
    expect(result?.title).toBe("Real title")
    expect(result?.image).toBe("https://publisher.test/cover.jpg")
  })
  it("ignores another article and descriptions without articleBody", () => {
    const html = page([
      {
        "@type": "Article",
        url: "https://publisher.test/other",
        articleBody: body,
      },
      { "@type": "Article", url, description: body },
    ])
    expect(structuredArticle(parseHTML(html).document, url)).toBeNull()
  })
  it("keeps readable text after malformed JSON and sanitizes structured HTML", () => {
    const html = page({
      "@type": "BlogPosting",
      url,
      articleBody: `<p>${body}</p><img src="/image.jpg" onerror="bad()"><script>bad()</script>`,
    }).replace(
      "<script type=",
      '<script type="application/ld+json">broken</script><script type='
    )
    const result = extractReadable(html, url)
    expect(result?.contentHtml).toContain(body.trim())
    expect(result?.contentHtml).not.toMatch(/onerror|<script|bad\(\)/)
  })
})
