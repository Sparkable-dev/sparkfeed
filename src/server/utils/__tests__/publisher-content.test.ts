import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  publisherAmpUrl,
  publisherArticleKey,
  publisherFeedContent,
} from "../publisher-content"

const fetchPage = vi.hoisted(() => vi.fn())
vi.mock("../fetch", () => ({ safeFetchText: fetchPage }))
beforeEach(() => {
  fetchPage.mockReset()
})
const base = "https://publisher.test/story?id=1"

describe("publisher alternatives", () => {
  it("matches only the same article, ignoring analytics and fragments", () => {
    expect(publisherArticleKey(`${base}&utm_source=rss#section`)).toBe(
      publisherArticleKey(base)
    )
    expect(publisherArticleKey(base)).not.toBe(
      publisherArticleKey("https://publisher.test/story?id=2")
    )
    expect(publisherArticleKey("javascript:alert(1)")).toBeNull()
  })
  it("uses declared same-origin AMP pages only", () => {
    expect(
      publisherAmpUrl('<link rel="amphtml" href="/story/amp">', base)
    ).toBe("https://publisher.test/story/amp")
    expect(
      publisherAmpUrl(
        '<link rel="amphtml" href="https://elsewhere.test/amp">',
        base
      )
    ).toBeNull()
    expect(publisherAmpUrl('<a href="/amp">AMP</a>', base)).toBeNull()
  })
  it("selects full content from the exact feed entry and sanitizes it", async () => {
    const body = JSON.stringify({
      version: "https://jsonfeed.org/version/1.1",
      title: "Feed",
      items: [
        {
          id: "wrong",
          url: "https://publisher.test/story?id=2",
          content_html: "WRONG",
        },
        {
          id: "right",
          url: `${base}&utm_source=rss`,
          content_html:
            '<p>Full body</p><img src="/image.png" onerror="alert(1)"><script>bad()</script>',
        },
      ],
    })
    fetchPage.mockResolvedValue({ res: new Response(body), text: body })
    const html = await publisherFeedContent(
      "https://publisher.test/feed.json",
      base
    )
    expect(html).toContain("Full body")
    expect(html).toContain('src="https://publisher.test/image.png"')
    expect(html).not.toMatch(/WRONG|onerror|bad\(\)/)
  })
  it("does not promote RSS descriptions into full articles", async () => {
    const body = `<rss version="2.0"><channel><title>Feed</title><link>https://publisher.test</link><description>Feed</description><item><title>Article</title><link>https://publisher.test/story?id=1</link><description>Only a summary.</description></item></channel></rss>`
    fetchPage.mockResolvedValue({ res: new Response(body), text: body })
    expect(
      await publisherFeedContent("https://publisher.test/rss", base)
    ).toBeNull()
  })
})
