import { QueryClient } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { invalidateWorkspace, workspaceQuery } from "./workspace-query"
import { previewQuery } from "./preview-query"

const mocks = vi.hoisted(() => ({ navigation: vi.fn(), preview: vi.fn() }))
vi.mock("@/server/rss", () => ({
  getAllData: mocks.navigation,
  getArticlePreview: mocks.preview,
}))
let client: QueryClient
const scope = { userId: "alice", workspaceId: "team1" }
beforeEach(() => {
  vi.clearAllMocks()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  mocks.navigation.mockResolvedValue({ folders: [], feeds: [], articles: [] })
  mocks.preview.mockResolvedValue({ readerHtml: "<p>Saved preview</p>" })
})
afterEach(() => client.clear())
describe("workspace query cache", () => {
  it("shares concurrent and subsequent navigation loads", async () => {
    await Promise.all([
      client.fetchQuery(workspaceQuery(scope)),
      client.fetchQuery(workspaceQuery(scope)),
    ])
    await client.fetchQuery(workspaceQuery(scope))
    expect(mocks.navigation).toHaveBeenCalledOnce()
  })
  it("never shares entries across people or workspaces", async () => {
    await client.fetchQuery(workspaceQuery(scope))
    await client.fetchQuery(workspaceQuery({ ...scope, userId: "bob" }))
    await client.fetchQuery(workspaceQuery({ ...scope, workspaceId: "team2" }))
    expect(mocks.navigation).toHaveBeenCalledTimes(3)
  })
  it("invalidates navigation once without discarding reusable previews", async () => {
    await client.fetchQuery(workspaceQuery(scope))
    await client.fetchQuery(previewQuery(scope, "article"))
    const router = {
      options: { context: { queryClient: client } },
      invalidate: vi.fn(async () => {
        await client.fetchQuery(workspaceQuery(scope))
      }),
    }
    await invalidateWorkspace(router as never)
    await client.fetchQuery(previewQuery(scope, "article"))
    expect(mocks.navigation).toHaveBeenCalledTimes(2)
    expect(mocks.preview).toHaveBeenCalledOnce()
  })
  it("caches previews and forwards cancellation to the transport", async () => {
    let signal: AbortSignal | undefined
    mocks.preview.mockImplementation(
      ({ signal: requestSignal }) =>
        new Promise((_resolve, reject) => {
          signal = requestSignal
          signal!.addEventListener("abort", () =>
            reject(new Error("cancelled"))
          )
        })
    )
    const pending = client
      .fetchQuery(previewQuery(scope, "slow"))
      .catch(() => undefined)
    await client.cancelQueries({
      queryKey: previewQuery(scope, "slow").queryKey,
    })
    await pending
    expect(signal?.aborted).toBe(true)
  })
})
