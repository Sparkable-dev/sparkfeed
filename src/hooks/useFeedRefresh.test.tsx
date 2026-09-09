// @vitest-environment jsdom
import { StrictMode } from "react"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useFeedRefresh } from "./useFeedRefresh"

const mocks = vi.hoisted(() => ({
  stale: vi.fn(),
  all: vi.fn(),
  feed: vi.fn(),
  folder: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}))
vi.mock("@/server/rss", () => ({
  refreshStaleFeeds: mocks.stale,
  refreshAllFeeds: mocks.all,
  refreshFeed: mocks.feed,
  refreshFolder: mocks.folder,
}))
vi.mock("sonner", () => ({
  toast: { error: mocks.error, warning: mocks.warning },
}))
const feed = {
  id: "f1",
  name: "Feed",
  url: "https://example.test",
  folderId: null,
  workspaceId: "w1",
  lastFetchedAt: "2026-01-01T00:00:00Z",
}
const reloaded = vi.fn<() => Promise<void>>()
beforeEach(() => {
  vi.clearAllMocks()
  for (const fn of [mocks.stale, mocks.all, mocks.folder])
    fn.mockResolvedValue({ refreshed: 1, failed: 0, inserted: 2 })
  mocks.feed.mockResolvedValue({ ok: true, inserted: 2 })
  reloaded.mockResolvedValue()
})
afterEach(cleanup)

describe("page-entry refresh", () => {
  it("refreshes once even under StrictMode and waits for refreshed data", async () => {
    let finish!: () => void
    reloaded.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve
      })
    )
    const { result, rerender } = renderHook(
      () =>
        useFeedRefresh({ feeds: [feed], enabled: true, onRefreshed: reloaded }),
      { wrapper: StrictMode }
    )
    await waitFor(() => expect(reloaded).toHaveBeenCalledOnce())
    expect(result.current.refreshing).toBe(true)
    rerender()
    expect(mocks.stale).toHaveBeenCalledExactlyOnceWith({
      data: { workspaceId: "w1" },
    })
    await act(() => {
      finish()
    })
    expect(result.current.refreshing).toBe(false)
  })
  it("skips fresh, paused, empty, demo and guest data", () => {
    for (const feeds of [
      [],
      [{ ...feed, lastFetchedAt: new Date().toISOString() }],
      [{ ...feed, entitlementPausedAt: "paused" }],
      [{ ...feed, workspaceId: undefined }],
    ]) {
      renderHook(() =>
        useFeedRefresh({ feeds, enabled: true, onRefreshed: reloaded })
      )
    }
    renderHook(() =>
      useFeedRefresh({ feeds: [feed], enabled: false, onRefreshed: reloaded })
    )
    expect(mocks.stale).not.toHaveBeenCalled()
  })
  it("does not retry in a loop after failure; manual retry still works", async () => {
    mocks.stale.mockRejectedValueOnce(new Error("offline"))
    const { result, rerender } = renderHook(() =>
      useFeedRefresh({ feeds: [feed], enabled: true, onRefreshed: reloaded })
    )
    await waitFor(() => expect(mocks.error).toHaveBeenCalledOnce())
    rerender()
    expect(mocks.stale).toHaveBeenCalledOnce()
    await act(async () => {
      await result.current.refresh()
    })
    expect(mocks.all).toHaveBeenCalledOnce()
  })
  it("checks a newly selected workspace", async () => {
    const { rerender } = renderHook(
      ({ workspaceId }) =>
        useFeedRefresh({
          feeds: [{ ...feed, workspaceId }],
          enabled: true,
          onRefreshed: reloaded,
        }),
      { initialProps: { workspaceId: "w1" } }
    )
    await waitFor(() => expect(reloaded).toHaveBeenCalledOnce())
    rerender({ workspaceId: "w2" })
    await waitFor(() =>
      expect(mocks.stale).toHaveBeenLastCalledWith({
        data: { workspaceId: "w2" },
      })
    )
  })
  it("manual feed refresh targets only that feed, with failure feedback", async () => {
    mocks.feed.mockResolvedValue({ ok: false, inserted: 0 })
    const { result } = renderHook(() =>
      useFeedRefresh({
        feeds: [{ ...feed, lastFetchedAt: new Date().toISOString() }],
        enabled: true,
        feedId: "f1",
        folderId: "folder",
        onRefreshed: reloaded,
      })
    )
    await act(async () => {
      await result.current.refresh()
    })
    expect(mocks.feed).toHaveBeenCalledExactlyOnceWith({
      data: { feedId: "f1" },
    })
    expect(mocks.folder).not.toHaveBeenCalled()
    expect(mocks.warning).toHaveBeenCalledOnce()
  })
  it("does not duplicate a refresh while one is running", async () => {
    let finish!: (value: unknown) => void
    mocks.stale.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    const { result } = renderHook(() =>
      useFeedRefresh({ feeds: [feed], enabled: true, onRefreshed: reloaded })
    )
    await act(async () => {
      await result.current.refresh()
    })
    expect(mocks.all).not.toHaveBeenCalled()
    await act(() => {
      finish({ failed: 0, inserted: 0, refreshed: 1 })
    })
  })
  it("checks the next workspace after an overlapping refresh finishes", async () => {
    let finish!: (value: unknown) => void
    mocks.stale.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    const { rerender } = renderHook(
      ({ workspaceId }) =>
        useFeedRefresh({
          feeds: [{ ...feed, workspaceId }],
          enabled: true,
          onRefreshed: reloaded,
        }),
      { initialProps: { workspaceId: "w1" } }
    )
    rerender({ workspaceId: "w2" })
    expect(mocks.stale).toHaveBeenCalledOnce()
    await act(() => {
      finish({ failed: 0, inserted: 0, refreshed: 1 })
    })
    await waitFor(() =>
      expect(mocks.stale).toHaveBeenLastCalledWith({
        data: { workspaceId: "w2" },
      })
    )
  })
})
