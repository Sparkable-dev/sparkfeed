import { describe, expect, it } from "vitest"
import { articleUrl, parseSyndication } from "../parse-feed"
import { safeParseDate } from "../dates"

const rss = (items: string, extra = "") =>
  `<rss version="2.0" ${extra}><channel><title>Example</title><link>https://example.com</link><description>News</description>${items}</channel></rss>`

describe("FeedSmith normalization", () => {
  it("rejects impossible calendar dates and uses UTC for timezone-less ISO input", () => {
    expect(safeParseDate("2025-02-29T12:00:00Z")).toBeNull()
    expect(safeParseDate("2026-09-09T12:00:00")).toBe(
      "2026-09-09T12:00:00.000Z"
    )
  })
  it("preserves GUID, namespace content, creator, date, and media images", () => {
    const result = parseSyndication(
      rss(
        `<item><title>A &amp; B</title><link>/posts/one</link><guid isPermaLink="false">opaque:one</guid><pubDate>Wed, 09 Sep 2026 08:00:00 GMT</pubDate><custom:encoded><![CDATA[<p>Complete article</p>]]></custom:encoded><dc:creator>Ada</dc:creator><media:content url="/video.mp4" type="video/mp4"/><media:content url="/image.jpg" type="image/jpeg"/></item>`,
        'xmlns:custom="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/"'
      ),
      "https://example.com/feed"
    )
    expect(result.items[0]).toMatchObject({
      sourceId: "opaque:one",
      link: "https://example.com/posts/one",
      title: "A & B",
      content: "<p>Complete article</p>",
      authors: ["Ada"],
      isoDate: "2026-09-09T08:00:00.000Z",
      image: "https://example.com/image.jpg",
    })
  })
  it("does not mistake an opaque GUID for an article URL", () => {
    const item = parseSyndication(
      rss(
        '<item><title>Standalone</title><guid isPermaLink="false">id-1</guid></item>'
      ),
      "https://example.com/feed"
    ).items[0]
    expect(item.sourceId).toBe("id-1")
    expect(item.link).toBeUndefined()
  })
  it("uses a URL GUID when the permalink flag permits it", () => {
    expect(
      parseSyndication(
        rss(
          "<item><title>Standalone</title><guid>https://example.com/a</guid></item>"
        )
      ).items[0].link
    ).toBe("https://example.com/a")
  })
  it("selects the Atom alternate link, not its self or enclosure link", () => {
    const result = parseSyndication(
      `<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title><id>urn:feed</id><updated>2026-09-09T10:00:00Z</updated><entry><id>urn:one</id><title>One</title><link rel="self" href="/api/one"/><link rel="enclosure" href="/one.mp3"/><link rel="alternate" type="text/html" href="/one"/><published>2020-01-01T05:30:00+05:30</published><updated>2026-09-09T10:00:00Z</updated><content type="html">&lt;p&gt;Body&lt;/p&gt;</content></entry></feed>`,
      "https://example.com/feed"
    )
    expect(result.items[0]).toMatchObject({
      link: "https://example.com/one",
      sourceId: "urn:one",
      content: "<p>Body</p>",
      isoDate: "2020-01-01T00:00:00.000Z",
      updatedAt: "2026-09-09T10:00:00.000Z",
    })
  })
  it("preserves Atom XHTML markup", () => {
    const result = parseSyndication(
      `<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title><entry><id>urn:one</id><title>One</title><content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>Hello <strong>reader</strong></p></div></content></entry></feed>`
    )
    expect(result.items[0].content).toContain("<strong>reader</strong>")
  })
  it("supports JSON Feed and escapes plain-text bodies", () => {
    const result = parseSyndication(
      JSON.stringify({
        version: "https://jsonfeed.org/version/1.1",
        title: "JSON",
        items: [
          {
            id: "1",
            url: "/one",
            content_text: "<script>plain text</script>",
            date_published: "invalid",
          },
        ],
      }),
      "https://example.com/feed.json"
    )
    expect(result.format).toBe("json")
    expect(result.items[0].content).toBe(
      "<p>&lt;script&gt;plain text&lt;/script&gt;</p>"
    )
    expect(result.items[0].isoDate).toBeUndefined()
  })
  it("does not confuse a quoted doctype in article content with an XML declaration", () => {
    const content = "<!DOCTYPE html><p>Article body</p>"
    const json = parseSyndication(
      JSON.stringify({
        version: "https://jsonfeed.org/version/1.1",
        title: "JSON",
        items: [{ id: "1", content_html: content }],
      })
    )
    expect(json.items[0].content).toBe(content)
    expect(
      parseSyndication(
        rss(
          `<item><title>Example</title><description><![CDATA[${content}]]></description></item>`
        )
      ).items[0].summary
    ).toBe(content)
  })
  it("supports RDF date and full content", () => {
    const result = parseSyndication(
      `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel rdf:about="https://example.com/feed"><title>RDF</title><link>https://example.com</link><description>News</description></channel><item rdf:about="https://example.com/one"><title>One</title><link>https://example.com/one</link><dc:date>2026-09-01T00:00:00Z</dc:date></item></rdf:RDF>`
    )
    expect(result.format).toBe("rdf")
    expect(result.items[0].isoDate).toBe("2026-09-01T00:00:00.000Z")
  })
  it.each([
    '<!DOCTYPE rss [<!ENTITY boom "bad">]><rss/>',
    "<html><title>Checking your browser</title></html>",
    "{}",
  ])("rejects unsafe or non-feed input", (body) => {
    expect(() => parseSyndication(body)).toThrow()
  })
  it("rejects executable and credential-bearing links", () => {
    expect(articleUrl("javascript:alert(1)")).toBeUndefined()
    expect(articleUrl("https://user:pass@example.com")).toBeUndefined()
    expect(articleUrl("/one?article=2#heading", "https://example.com")).toBe(
      "https://example.com/one?article=2#heading"
    )
  })
})
