// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { PreviewSheet } from "./PreviewSheet"
import type { ArticleRow } from "./ArticleGrid"
import { useReaderPrefs } from "@/store/readerPrefs"

const fixture = vi.hoisted(() => ({
  html: '<h2 id="section">Section</h2><p>Body</p><h3>Subsection</h3>',
  canEmbed: false,
  readerLoading: false,
  embedPending: false,
  toast: vi.fn(),
}))
vi.mock("sonner", () => ({ toast: { info: fixture.toast } }))
vi.mock("@/components/WorkspaceDataProvider", () => ({
  useWorkspaceScope: () => ({ userId: "test", workspaceId: "test" }),
}))
vi.mock("@/hooks/guest-share-context", () => ({ useGuestShare: () => null }))
vi.mock("@/server/rss", () => ({
  getArticlePreview: vi.fn(),
  getArticleEmbedAvailability: vi.fn(),
  getAllData: vi.fn(),
}))
vi.mock("@tanstack/react-query", () => ({
  queryOptions: (value: unknown) => value,
  useQuery: ({ queryKey }: { queryKey: Array<string> }) => ({
    data: queryKey.includes("embed")
      ? { canEmbed: fixture.canEmbed }
      : {
          readerHtml: fixture.html,
          domain: "example.com",
          link: "https://example.com/article",
        },
    isPending: queryKey.includes("embed")
      ? fixture.embedPending
      : fixture.readerLoading,
    isFetching: false,
  }),
}))
const article = {
  id: "article",
  title: "Article title",
  feedName: "Example",
  link: "https://example.com/article",
  domain: "example.com",
} as ArticleRow

beforeEach(() => {
  fixture.html = '<h2 id="section">Section</h2><p>Body</p><h3>Subsection</h3>'
  fixture.canEmbed = false
  fixture.readerLoading = false
  fixture.embedPending = false
  fixture.toast.mockReset()
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }))
  HTMLElement.prototype.scrollTo = vi.fn()
  useReaderPrefs.setState({
    fontScale: 1,
    width: "narrow",
    theme: "dark",
    zenMode: false,
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
})

it("keeps rendered heading nodes stable through tracking and preference updates", async () => {
  render(<PreviewSheet article={article} onClose={vi.fn()} />)
  await screen.findByRole("navigation", { name: "Article contents" })
  const heading = document.querySelector(".reader-prose h2")
  const scroller = document.querySelector<HTMLElement>(
    ".reader-surface.overflow-y-auto"
  )!
  scroller.scrollTop = 200
  fireEvent.scroll(scroller)
  act(() => {
    useReaderPrefs.getState().setTheme("sepia")
    useReaderPrefs.getState().increaseFont()
  })
  await waitFor(() =>
    expect(document.querySelector(".reader-prose h2")).toBe(heading)
  )
  expect(scroller.scrollTop).toBe(200)
  act(() => useReaderPrefs.getState().setZenMode(true))
  expect(document.querySelector(".reader-prose h2")).toBe(heading)
  expect(scroller.scrollTop).toBe(200)
})

it("keeps navigation and reading options in the blocked-Live fallback", async () => {
  render(<PreviewSheet article={article} onClose={vi.fn()} />)
  fireEvent.click(screen.getByRole("button", { name: "Live" }))
  expect(fixture.toast).toHaveBeenCalledOnce()
  expect(screen.getByRole("button", { name: "Copy article" })).toBeTruthy()
  expect(
    screen.getByRole("button", { name: "Reader" }).getAttribute("aria-pressed")
  ).toBe("true")
  expect(
    screen.getByRole("button", { name: "Live" }).getAttribute("aria-pressed")
  ).toBe("false")
  expect(
    await screen.findByRole("navigation", { name: "Article contents" })
  ).toBeTruthy()
  expect(screen.getByRole("button", { name: "Reading options" })).toBeTruthy()
})

it("removes the rail for actual Live and rebuilds it on returning to Reader", async () => {
  fixture.canEmbed = true
  render(<PreviewSheet article={article} onClose={vi.fn()} />)
  await screen.findByRole("navigation", { name: "Article contents" })
  fireEvent.click(screen.getByRole("button", { name: "Live" }))
  expect(document.querySelector("iframe")?.src).toBe(article.link)
  expect(screen.queryByRole("button", { name: "Copy article" })).toBeNull()
  expect(
    screen.queryByRole("navigation", { name: "Article contents" })
  ).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "Reader" }))
  expect(
    await screen.findByRole("navigation", { name: "Article contents" })
  ).toBeTruthy()
})

it("clears the old outline for a replacement article without headings", async () => {
  const { rerender } = render(
    <PreviewSheet article={article} onClose={vi.fn()} />
  )
  await screen.findByRole("navigation", { name: "Article contents" })
  fixture.html = "<p>No section headings here</p>"
  rerender(
    <PreviewSheet
      article={{ ...article, id: "replacement" }}
      onClose={vi.fn()}
    />
  )
  await waitFor(() =>
    expect(
      screen.queryByRole("navigation", { name: "Article contents" })
    ).toBeNull()
  )
})

it("opens Live independently when Reader is still loading", () => {
  fixture.canEmbed = true
  fixture.readerLoading = true
  render(<PreviewSheet article={article} onClose={vi.fn()} />)
  fireEvent.click(screen.getByRole("button", { name: "Live" }))
  expect(document.querySelector("iframe")?.src).toBe(article.link)
  expect(screen.queryByRole("button", { name: "Copy article" })).toBeNull()
})

it("preserves reading position while checking Live and after returning", () => {
  fixture.canEmbed = true
  fixture.embedPending = true
  const { rerender } = render(
    <PreviewSheet article={article} onClose={vi.fn()} />
  )
  const scroller = document.querySelector<HTMLElement>(
    ".reader-surface.overflow-y-auto"
  )!
  scroller.scrollTop = 240
  fireEvent.click(screen.getByRole("button", { name: "Live" }))
  expect(document.querySelector(".reader-surface.overflow-y-auto")).toBe(
    scroller
  )
  fixture.embedPending = false
  rerender(<PreviewSheet article={article} onClose={vi.fn()} />)
  expect(document.querySelector("iframe")).toBeTruthy()
  fireEvent.click(screen.getByRole("button", { name: "Back to Reader" }))
  expect(
    document.querySelector(".reader-surface.overflow-y-auto")?.scrollTop
  ).toBe(240)
})

it("resets Live when switching articles and clears a stalled frame after timeout", () => {
  vi.useFakeTimers()
  try {
    fixture.canEmbed = true
    const { rerender } = render(
      <PreviewSheet article={article} onClose={vi.fn()} />
    )
    fireEvent.click(screen.getByRole("button", { name: "Live" }))
    act(() => vi.advanceTimersByTime(15_000))
    expect(document.querySelector("iframe")).toBeNull()
    expect(fixture.toast).toHaveBeenCalledOnce()
    expect(screen.getByRole("button", { name: "Copy article" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Live" }))
    rerender(
      <PreviewSheet article={{ ...article, id: "other" }} onClose={vi.fn()} />
    )
    expect(document.querySelector("iframe")).toBeNull()
    expect(
      screen
        .getByRole("button", { name: "Reader" })
        .getAttribute("aria-pressed")
    ).toBe("true")
  } finally {
    vi.useRealTimers()
  }
})

it("disables copy for an empty Reader body", () => {
  fixture.html = "<div> </div>"
  render(<PreviewSheet article={article} onClose={vi.fn()} />)
  expect(
    screen
      .getByRole("button", { name: /not available to copy/ })
      .getAttribute("aria-disabled")
  ).toBe("true")
})
