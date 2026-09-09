import { beforeEach, describe, expect, it, vi } from "vitest"

const lookup = vi.hoisted(() => vi.fn())
const fetchRemote = vi.hoisted(() => vi.fn())
vi.mock("node:dns/promises", () => ({ lookup }))
vi.mock("undici", async () => ({
  ...(await vi.importActual("undici")),
  fetch: fetchRemote,
}))
const {
  publicSocketLookup,
  safeFetchText,
  BlockedUrlError,
  ResponseTooLargeError,
} = await import("../fetch")
beforeEach(() => {
  lookup.mockReset()
  fetchRemote.mockReset()
})

describe("guarded feed transport", () => {
  it("checks the exact address used for a socket after DNS rebinding", async () => {
    lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }])
    const outcome = await new Promise((resolve) =>
      publicSocketLookup("rebind.test", { all: true }, (err, address) =>
        resolve({ err, address })
      )
    )
    expect(outcome).toMatchObject({
      err: expect.any(BlockedUrlError),
      address: "",
    })
  })
  it("passes only public validated addresses to the connector", async () => {
    lookup.mockResolvedValue([{ address: "1.1.1.1", family: 4 }])
    const outcome = await new Promise((resolve) =>
      publicSocketLookup("public.test", { all: true }, (err, address) =>
        resolve({ err, address })
      )
    )
    expect(outcome).toEqual({
      err: null,
      address: [{ address: "1.1.1.1", family: 4 }],
    })
  })
  it("identifies Sparkfeed and uses the guarded dispatcher", async () => {
    fetchRemote.mockResolvedValue(new Response("<rss/>"))
    await safeFetchText("https://1.1.1.1/feed")
    const options = fetchRemote.mock.lastCall![1]
    expect(options.headers.get("user-agent")).toContain("Sparkfeed/")
    expect(options.dispatcher).toBeDefined()
    expect(options.redirect).toBe("manual")
  })
  it("rejects private redirect targets before a second request", async () => {
    fetchRemote.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/secret" },
      })
    )
    await expect(safeFetchText("https://1.1.1.1/feed")).rejects.toBeInstanceOf(
      BlockedUrlError
    )
    expect(fetchRemote).toHaveBeenCalledOnce()
  })
  it("decodes declared XML encoding without corrupting article text", async () => {
    fetchRemote.mockResolvedValue(
      new Response(
        Buffer.from(
          '<?xml version="1.0" encoding="ISO-8859-1"?><title>caf\u00e9</title>',
          "latin1"
        )
      )
    )
    expect((await safeFetchText("https://1.1.1.1/feed")).text).toContain("café")
  })
  it("enforces the streamed body limit even without Content-Length", async () => {
    fetchRemote.mockResolvedValue(new Response("too many bytes"))
    await expect(
      safeFetchText("https://1.1.1.1/feed", { maxBytes: 4 })
    ).rejects.toBeInstanceOf(ResponseTooLargeError)
  })
})
