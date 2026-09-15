import { beforeEach, describe, expect, it, vi } from "vitest"
import { loadReaderPreview } from "../reader-preview"

const fetchPage = vi.hoisted(() => vi.fn())
vi.mock("../fetch", () => ({ safeFetchText: fetchPage }))
const saved = {
  link: "https://example.com/article",
  content: "<p>Saved text</p><h2>Missing section</h2>",
  contentSource: "extracted",
  contentErrorAt: null,
  description: "Feed summary",
}
const full = `<html><head><title>Article</title></head><body><article><p>${"This article contains detailed material, useful examples, and a complete account of the events. ".repeat(15)}</p></article></body></html>`

beforeEach(() => {
  fetchPage.mockReset()
})
describe("reader cache recovery", () => {
  it("repairs incomplete extracted content and returns a cache update", async () => {
    fetchPage.mockResolvedValue({
      res: new Response(full),
      text: full,
      finalUrl: saved.link,
    })
    const result = await loadReaderPreview(saved)
    expect(fetchPage).toHaveBeenCalledOnce()
    expect(result.readerHtml).toContain("complete account")
    expect(result.cacheUpdate?.content).toBe(result.readerHtml)
    expect(result.cacheUpdate?.contentErrorAt).toBeNull()
    expect(result.notice).toBeNull()
  })
  it("preserves saved content when a repair fails and records backoff", async () => {
    fetchPage.mockRejectedValue(new Error("timeout"))
    const result = await loadReaderPreview(saved)
    expect(result.readerHtml).toBe(saved.content)
    expect(result.cacheUpdate?.content).toBeUndefined()
    expect(result.cacheUpdate?.contentErrorAt).toBeTruthy()
    expect(result.notice).toBe("partial")
  })
  it("does not refetch complete saved articles or retry during cooldown", async () => {
    await loadReaderPreview({
      ...saved,
      content:
        '<div data-reader-version="3"><h2>Section</h2><p>Complete body</p></div>',
    })
    await loadReaderPreview({
      ...saved,
      contentErrorAt: new Date().toISOString(),
    })
    expect(fetchPage).not.toHaveBeenCalled()
  })
  it("distinguishes publisher access blocks from extraction failures", async () => {
    fetchPage.mockResolvedValue({
      res: new Response("Denied", { status: 403 }),
      text: "Denied",
      finalUrl: saved.link,
    })
    const result = await loadReaderPreview({ ...saved, content: null })
    expect(result.notice).toBe("blocked")
    expect(result.quality).toBe("summary")
    expect(result.readerHtml).toBe("Feed summary")
    expect(result.cacheUpdate?.content).toBeUndefined()
  })
})

it("does not replace a longer cached article with a shorter extraction", async () => {
  fetchPage.mockResolvedValue({
    res: new Response(full),
    text: full,
    finalUrl: saved.link,
  })
  const content = `<p>${"A valuable saved paragraph that must remain available. ".repeat(100)}</p>`
  const result = await loadReaderPreview({ ...saved, content })
  expect(result.readerHtml).toBe(content)
  expect(result.cacheUpdate?.content).toBeUndefined()
})

it("recovers full feed content after a blocked page without mistaking its summary for the body", async () => {
  const feed = JSON.stringify({
    version: "https://jsonfeed.org/version/1.1",
    title: "Feed",
    items: [
      {
        id: "one",
        url: saved.link,
        content_html:
          "<p>Full publisher content, with the conclusion preserved. Enough substantive detail to recover the whole article.</p>",
      },
    ],
  })
  fetchPage
    .mockResolvedValueOnce({
      res: new Response("Denied", { status: 403 }),
      text: "Denied",
    })
    .mockResolvedValueOnce({ res: new Response(feed), text: feed })
  const result = await loadReaderPreview({
    ...saved,
    content: null,
    feedUrl: "https://example.com/feed.json",
  })
  expect(result.quality).toBe("feed")
  expect(result.notice).toBeNull()
  expect(result.readerHtml).toContain("conclusion preserved")
  expect(result.cacheUpdate?.contentSource).toBe("feed")
})

it("uses an advertised AMP alternative when the original page has no readable body", async () => {
  const shell =
    '<html><head><link rel="amphtml" href="/article/amp"></head><body>Loading</body></html>'
  fetchPage
    .mockResolvedValueOnce({
      res: new Response(shell),
      text: shell,
      finalUrl: saved.link,
    })
    .mockResolvedValueOnce({
      res: new Response(full),
      text: full,
      finalUrl: `${saved.link}/amp`,
    })
  const result = await loadReaderPreview({ ...saved, content: null })
  expect(fetchPage.mock.calls[1][0]).toBe("https://example.com/article/amp")
  expect(result.readerHtml).toContain("complete account")
  expect(result.notice).toBeNull()
})
