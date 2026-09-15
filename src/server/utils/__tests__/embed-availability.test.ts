import { beforeEach, describe, expect, it, vi } from "vitest"
import { embedPolicy, inspectEmbedAvailability } from "../embed-availability"

const fetchPage = vi.hoisted(() => vi.fn())
vi.mock("../fetch", () => ({ safeFetch: fetchPage }))
beforeEach(() => {
  fetchPage.mockReset()
})
const page = "https://publisher.test/article"
const parent = "https://app.sparkfeed.test"
const policy = (value: string) =>
  embedPolicy(new Headers({ "content-security-policy": value }), page, parent)

describe("embedding policy", () => {
  it("distinguishes permitted ancestors from unrelated wildcard hosts", () => {
    expect(policy("frame-ancestors https://app.sparkfeed.test")).toBe("allowed")
    expect(policy("frame-ancestors https://*.sparkfeed.test")).toBe("allowed")
    expect(policy("frame-ancestors https://*.other.test")).toBe("blocked")
    expect(policy("frame-ancestors 'self'")).toBe("blocked")
    expect(policy("frame-ancestors 'none'")).toBe("blocked")
    expect(policy("frame-ancestors *")).toBe("allowed")
  })
  it("requires every enforced policy to allow the parent", () => {
    expect(policy("frame-ancestors *, frame-ancestors 'none'")).toBe("blocked")
    expect(policy("default-src 'none'")).toBe("allowed")
    expect(
      embedPolicy(
        new Headers({
          "content-security-policy-report-only": "frame-ancestors 'none'",
        }),
        page,
        parent
      )
    ).toBe("allowed")
  })
  it("honors CSP precedence and same-origin XFO", () => {
    expect(
      embedPolicy(
        new Headers({
          "x-frame-options": "DENY",
          "content-security-policy": "frame-ancestors *",
        }),
        page,
        parent
      )
    ).toBe("allowed")
    expect(
      embedPolicy(
        new Headers({ "x-frame-options": "SAMEORIGIN" }),
        page,
        parent
      )
    ).toBe("blocked")
    expect(
      embedPolicy(
        new Headers({ "x-frame-options": "SAMEORIGIN" }),
        page,
        "https://publisher.test"
      )
    ).toBe("allowed")
  })
  it("keeps unrecognized policies inconclusive instead of falsely approving them", () => {
    expect(policy("frame-ancestors https://host.test/specific/path")).toBe(
      "unknown"
    )
  })
})

it("checks GET headers and cancels the body without extracting Reader content", async () => {
  const response = new Response("website", {
    headers: { "x-frame-options": "DENY" },
  })
  const cancel = vi.spyOn(response.body!, "cancel")
  fetchPage.mockResolvedValue(response)
  expect(await inspectEmbedAvailability(page, parent)).toEqual({
    availability: "blocked",
    canEmbed: false,
  })
  expect(fetchPage).toHaveBeenCalledWith(page, {
    method: "GET",
    timeoutMs: 5000,
  })
  expect(cancel).toHaveBeenCalledOnce()
})
it("allows a browser attempt when the server is blocked or unavailable", async () => {
  fetchPage.mockResolvedValueOnce(new Response("Denied", { status: 403 }))
  expect((await inspectEmbedAvailability(page, parent)).availability).toBe(
    "unknown"
  )
  fetchPage.mockRejectedValueOnce(new Error("timeout"))
  expect((await inspectEmbedAvailability(page, parent)).canEmbed).toBe(true)
})
