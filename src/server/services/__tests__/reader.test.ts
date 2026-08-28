import { beforeEach, describe, expect, it, vi } from "vitest"
import type * as FetchModule from "../../utils/fetch"

/**
 * `read_url`, the one tool that fetches an address chosen from the
 * conversation.
 *
 * The SSRF guard is tested for real — `assertPublicUrl` runs, unmocked, against
 * a literal private address — because that is the property worth proving. The
 * rest stubs the network, since what is being tested is the judgement layered
 * on top: that a page which will not extract is *reported* rather than thrown
 * on, and that demo mode refuses before it reaches out at all.
 */

let fetchImpl: () => Promise<{
  res: Response
  text: string
  contentType: string
  finalUrl: string
}>

/*
  Falls through to the real implementation whenever a test does not install a
  stub. That is what the SSRF test relies on: it passes a literal private
  address, which `assertPublicUrl` rejects without a DNS lookup, so the guard is
  genuinely exercised while no test touches the network.
*/
vi.mock("../../utils/fetch", async (importOriginal) => {
  const actual = await importOriginal<typeof FetchModule>()
  return {
    ...actual,
    safeFetchText: async (url: string, options?: unknown) =>
      fetchImpl
        ? await fetchImpl()
        : await actual.safeFetchText(url, options as never),
  }
})

const { readUrl } = await import("../reader")

const PRINCIPAL = {
  keyId: "session",
  workspaceId: "ws-1",
  plan: "pro" as const,
  scopes: ["articles:read" as const],
  demo: false,
}

const page = (body: string, headers: Record<string, string> = {}) => ({
  res: new Response(null, { status: 200, headers }),
  text: `<!doctype html><html><head><title>t</title>${headers.head ?? ""}</head><body>${body}</body></html>`,
  contentType: "text/html",
  finalUrl: "https://example.com/post",
})

/** Readability needs real prose before it will call something an article. */
const ARTICLE = `
  <article>
    <h1>A considered headline</h1>
    ${Array.from(
      { length: 8 },
      () =>
        "<p>This is a paragraph of an article with enough words in it that a readability algorithm will consider the containing element to be the main content of the page rather than navigation chrome.</p>"
    ).join("")}
  </article>`

beforeEach(() => {
  fetchImpl = undefined as never
})

describe("what it refuses", () => {
  it("will not fetch a private address", async () => {
    /*
      The whole reason this tool is gated: a user-supplied URL pointing inside
      the network turns the server into a probe. No stub is installed, so this
      runs the real `safeFetchText` and therefore the real `assertPublicUrl` —
      what it proves is that `readUrl` goes through the guarded fetch rather
      than reaching for `fetch` directly.
    */
    await expect(
      readUrl(PRINCIPAL, { url: "http://127.0.0.1:8080/admin" })
    ).rejects.toThrow(/not.*(allowed|reachable|public)|private|blocked/i)
  })

  it("will not fetch anything in demo mode", async () => {
    fetchImpl = async () => page(ARTICLE)
    await expect(
      readUrl(
        { ...PRINCIPAL, demo: true },
        { url: "https://example.com/post" }
      )
    ).rejects.toThrow(/demo/i)
  })

  it("reports a page that is gone rather than pretending it read one", async () => {
    fetchImpl = async () => ({
      res: new Response(null, { status: 404 }),
      text: "",
      contentType: "text/html",
      finalUrl: "https://example.com/post",
    })
    await expect(
      readUrl(PRINCIPAL, { url: "https://example.com/post" })
    ).rejects.toThrow(/404/)
  })
})

describe("what it returns", () => {
  it("extracts an article and counts it", async () => {
    fetchImpl = async () => page(ARTICLE)

    const result = await readUrl(PRINCIPAL, { url: "https://example.com/post" })
    expect(result.source_quality).toBe("extracted")
    expect(result.reader_html).toContain("readability algorithm")
    expect(result.content).toContain("readability algorithm")
    expect(result.word_count).toBeGreaterThan(50)
    expect(result.domain).toBe("example.com")
  })

  it("reports an unreadable page instead of throwing", async () => {
    /*
      Paywalls, login walls and app shells are ordinary, not exceptional. The
      model has to be able to say "I could not read that" and carry on; a throw
      would surface as a tool failure and an apology, and would invite a retry
      that fails identically.
    */
    fetchImpl = async () => page("<div id='root'></div>")

    const result = await readUrl(PRINCIPAL, { url: "https://example.com/post" })
    expect(result.source_quality).toBe("failed")
    expect(result.reader_html).toBeNull()
    expect(result.content).toBe("")
    expect(result.word_count).toBe(0)
  })

  it("keeps the address it landed on, not the one it was given", async () => {
    // Redirects are the norm for shared links. The panel and the "open in a new
    // tab" button both need the address that actually served the page.
    fetchImpl = async () => ({
      ...page(ARTICLE),
      finalUrl: "https://example.com/2026/the-real-post",
    })

    const result = await readUrl(PRINCIPAL, {
      url: "https://example.com/le?utm_source=x",
    })
    expect(result.url).toBe("https://example.com/2026/the-real-post")
    expect(result.requested_url).toBe("https://example.com/le?utm_source=x")
  })

  it("says a framed preview is off when the publisher forbids it", async () => {
    fetchImpl = async () => page(ARTICLE, { "x-frame-options": "DENY" })
    expect(
      (await readUrl(PRINCIPAL, { url: "https://example.com/post" })).can_embed
    ).toBe(false)

    fetchImpl = async () => page(ARTICLE)
    expect(
      (await readUrl(PRINCIPAL, { url: "https://example.com/post" })).can_embed
    ).toBe(true)
  })
})
