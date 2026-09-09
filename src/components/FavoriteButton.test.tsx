// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { FavoriteButton } from "./FavoriteButton"
import { WorkspaceDataProvider } from "./WorkspaceDataProvider"
import { workspaceQuery } from "@/lib/workspace-query"

const mocks = vi.hoisted(() => ({ save: vi.fn(), error: vi.fn() }))
vi.mock("@/server/reader-data", () => ({ setFavorites: mocks.save }))
vi.mock("@/server/rss", () => ({ getAllData: vi.fn() }))
vi.mock("sonner", () => ({ toast: { error: mocks.error } }))
let client: QueryClient
const scope = { userId: "alice", workspaceId: "team1" }
const nav = {
  folders: [],
  feeds: [],
  articles: [],
  degraded: false as const,
  counts: { feeds: {}, folders: {}, total: 0, today: 0 },
  favorites: { personal: ["saved"], workspace: [], workspaceEnabled: true },
}
beforeEach(() => {
  vi.clearAllMocks()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(workspaceQuery(scope).queryKey, nav)
  mocks.save.mockResolvedValue({ ids: ["saved"] })
})
afterEach(() => {
  cleanup()
  client.clear()
})
function mount(favoriteScope: "personal" | "workspace" = "personal") {
  return render(
    <QueryClientProvider client={client}>
      <WorkspaceDataProvider value={scope}>
        <FavoriteButton articleId="saved" scope={favoriteScope} />
      </WorkspaceDataProvider>
    </QueryClientProvider>
  )
}
describe("favorite controls", () => {
  it("removes a database-backed personal favorite with an explicit false state", async () => {
    mount()
    fireEvent.click(
      screen.getByRole("button", { name: "Remove from personal favorites" })
    )
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith({
        data: { ...scope, ids: ["saved"], scope: "personal", state: false },
      })
    )
    expect(
      screen.getByRole("button", { name: "Add to personal favorites" })
    ).toBeTruthy()
  })
  it("rolls back a failed save and reports the error", async () => {
    mocks.save.mockRejectedValue(new Error("offline"))
    mount()
    fireEvent.click(
      screen.getByRole("button", { name: "Remove from personal favorites" })
    )
    await waitFor(() => expect(mocks.error).toHaveBeenCalledOnce())
    expect(
      screen.getByRole("button", { name: "Remove from personal favorites" })
    ).toBeTruthy()
  })
  it("keeps the workspace action separate and hides it when locked", async () => {
    mount("workspace")
    fireEvent.click(
      screen.getByRole("button", { name: "Add to workspace favorites" })
    )
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith({
        data: { ...scope, ids: ["saved"], scope: "workspace", state: true },
      })
    )
    cleanup()
    client.setQueryData(workspaceQuery(scope).queryKey, {
      ...nav,
      favorites: { ...nav.favorites, workspaceEnabled: false },
    })
    mount("workspace")
    expect(screen.queryByRole("button")).toBeNull()
  })
})
