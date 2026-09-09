import { beforeEach, describe, expect, it, vi } from "vitest"
import { generateXMLFeed } from "../generateXML"

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  suspended: vi.fn(),
  share: vi.fn(),
}))
vi.mock("@/db/index", () => ({ db: { select: () => ({ from: mocks.from }) } }))
vi.mock("@/lib/demo", () => ({ DEMO_MODE: false }))
vi.mock("@/server/entitlements/suspension", () => ({
  workspaceIsSuspended: mocks.suspended,
}))
vi.mock("@/server/services/shares", () => ({
  resolveInheritedShare: mocks.share,
}))
beforeEach(() => {
  vi.clearAllMocks()
  mocks.from.mockReset()
  mocks.from.mockReturnValueOnce(Promise.resolve([]))
  mocks.from.mockReturnValueOnce(
    Promise.resolve([
      {
        id: "feed1",
        name: "Public feed",
        folderId: null,
        workspaceId: "workspace1",
      },
    ])
  )
  mocks.from.mockReturnValue({
    where: () => ({ orderBy: () => ({ limit: () => Promise.resolve([]) }) }),
  })
  mocks.suspended.mockResolvedValue(false)
  mocks.share.mockResolvedValue({ isShared: true, password: null })
})
describe("public XML access", () => {
  it("does not export a suspended workspace", async () => {
    mocks.suspended.mockResolvedValue(true)
    expect(
      await generateXMLFeed("public-feed", "https://example.test")
    ).toBeNull()
    expect(mocks.from).toHaveBeenCalledTimes(2)
  })
  it("does not expose private content through the XML route", async () => {
    mocks.share.mockResolvedValue(null)
    expect(
      await generateXMLFeed("public-feed", "https://example.test")
    ).toBeNull()
  })
  it("does not bypass a share password", async () => {
    mocks.share.mockResolvedValue({ isShared: true, password: "hashed" })
    expect(
      await generateXMLFeed("public-feed", "https://example.test")
    ).toBeNull()
  })
  it("continues to export an active public feed", async () => {
    expect(
      await generateXMLFeed("public-feed", "https://example.test")
    ).toContain("<title>Public feed</title>")
  })
})
