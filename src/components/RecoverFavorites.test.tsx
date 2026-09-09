// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { RecoverFavorites } from "./RecoverFavorites"
import { WorkspaceDataProvider } from "./WorkspaceDataProvider"

const save = vi.hoisted(() => vi.fn())
vi.mock("@/server/reader-data", () => ({ setFavorites: save }))
vi.mock("@/server/rss", () => ({ getAllData: vi.fn() }))
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
let client: QueryClient
beforeEach(() => {
  localStorage.clear()
  save.mockReset()
  client = new QueryClient()
})
afterEach(() => {
  cleanup()
  client.clear()
  localStorage.clear()
})
function mount() {
  return render(
    <QueryClientProvider client={client}>
      <WorkspaceDataProvider value={{ userId: "alice", workspaceId: "team" }}>
        <RecoverFavorites />
      </WorkspaceDataProvider>
    </QueryClientProvider>
  )
}
it("does not show migration controls in a fresh browser", () => {
  mount()
  expect(screen.queryByRole("button")).toBeNull()
})
it("requires explicit recovery and keeps the legacy copy", async () => {
  const legacy = JSON.stringify({
    state: { favorites: ["saved", "other-workspace"] },
  })
  localStorage.setItem("rss-reader-favorites", legacy)
  save.mockResolvedValue({ ids: ["saved"] })
  mount()
  expect(save).not.toHaveBeenCalled()
  fireEvent.click(
    await screen.findByRole("button", { name: "Recover browser favorites" })
  )
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith({
      data: {
        userId: "alice",
        workspaceId: "team",
        ids: ["saved", "other-workspace"],
        scope: "personal",
        state: true,
      },
    })
  )
  expect(localStorage.getItem("rss-reader-favorites")).toBe(legacy)
})
it("keeps recovery data when the server rejects the request", async () => {
  const legacy = JSON.stringify({ state: { favorites: ["saved"] } })
  localStorage.setItem("rss-reader-favorites", legacy)
  save.mockRejectedValue(new Error("offline"))
  mount()
  fireEvent.click(
    await screen.findByRole("button", { name: "Recover browser favorites" })
  )
  await waitFor(() => expect(save).toHaveBeenCalledOnce())
  expect(localStorage.getItem("rss-reader-favorites")).toBe(legacy)
})
