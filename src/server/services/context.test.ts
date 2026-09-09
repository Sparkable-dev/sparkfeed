import { beforeEach, describe, expect, it, vi } from "vitest"
import { resolveWorkspaceContextFromHeaders } from "./context"

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  resolve: vi.fn(),
  activity: vi.fn(),
}))
vi.mock("@tanstack/react-start", () => ({
  createServerOnlyFn: (fn: unknown) => fn,
}))
vi.mock("@/lib/demo", () => ({ DEMO_MODE: false, DEMO_WORKSPACE_ID: "demo" }))
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: mocks.getSession } },
}))
vi.mock("@/server/entitlements/suspension", () => ({
  workspaceIsSuspended: async () =>
    (await mocks.resolve()).accessState === "suspended",
}))
vi.mock("@/server/platform/activity", () => ({
  recordPlatformActivity: mocks.activity,
}))
beforeEach(() => {
  mocks.getSession.mockResolvedValue({
    user: { id: "u1", emailVerified: true },
    session: { activeOrganizationId: "team1" },
  })
  mocks.resolve.mockResolvedValue({ accessState: "active" })
  mocks.activity.mockResolvedValue(undefined)
})
describe("workspace suspension at browser content boundary", () => {
  it("rejects suspended content while preserving the account session", async () => {
    mocks.resolve.mockResolvedValue({ accessState: "suspended" })
    await expect(
      resolveWorkspaceContextFromHeaders(new Headers())
    ).rejects.toThrow("Switch to another workspace")
  })
  it("allows other workspaces and read-only content", async () => {
    mocks.resolve.mockResolvedValue({ accessState: "read_only" })
    await expect(
      resolveWorkspaceContextFromHeaders(new Headers())
    ).resolves.toMatchObject({ workspaceId: "team1", userId: "u1" })
  })
  it("lets the dedicated access-notice endpoint inspect suspended state", async () => {
    mocks.resolve.mockResolvedValue({ accessState: "suspended" })
    await expect(
      resolveWorkspaceContextFromHeaders(new Headers(), {
        allowSuspended: true,
      })
    ).resolves.toMatchObject({ workspaceId: "team1" })
  })
})
