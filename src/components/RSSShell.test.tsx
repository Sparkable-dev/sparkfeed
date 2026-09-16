// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { RSSShell } from "./RSSShell"
import type { ReactNode } from "react"
import type { ArticleRow } from "./ArticleGrid"

const mocks = vi.hoisted(() => ({ invalidate: vi.fn(), refresh: vi.fn(), refreshing: false, loading: vi.fn(() => "refresh-toast"), dismiss: vi.fn() }))
vi.mock("sonner", () => ({ toast: { loading: mocks.loading, dismiss: mocks.dismiss, error: vi.fn(), warning: vi.fn(), success: vi.fn() } }))
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate: mocks.invalidate }),
  useNavigate: () => vi.fn(),
}))
vi.mock("@/hooks/useFeedRefresh", () => ({
  useFeedRefresh: () => ({ refreshing: mocks.refreshing, refresh: mocks.refresh }),
}))
vi.mock("@/server/rss", () => ({}))
vi.mock("@/components/app-sidebar", () => ({
  AppSidebar: ({ feeds }: any) => (
    <aside>{feeds.map((feed: any) => feed.name).join(",")}</aside>
  ),
}))
vi.mock("@/components/ui/sidebar", () => ({
  SidebarProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  SidebarInset: ({ children }: { children: ReactNode }) => <>{children}</>,
  useSidebar: () => ({ toggleSidebar: vi.fn() }),
}))
vi.mock("@/components/command/command-palette-context", () => ({
  useCommandAction: vi.fn(),
}))
vi.mock("@/components/add-feed/add-feed-context", () => ({
  useAddFeed: () => ({ openAddFeed: vi.fn() }),
}))
vi.mock("@/components/layout/CrumbMenu", () => ({ CrumbMenu: () => null }))
vi.mock("@/components/EditFeedModal", () => ({ EditFeedModal: () => null }))
vi.mock("@/components/FolderShareModal", () => ({
  FolderShareModal: () => null,
}))
vi.mock("@/components/folder/ManageModal", () => ({ ManageModal: () => null }))
vi.mock("@/components/layout/AppTopBar", () => ({
  AppTopBar: ({ actions }: any) => (
    <header>
      {actions.map((action: any) =>
        action.kind === "note" ? (
          <span key={action.id}>{action.text}</span>
        ) : action.kind === "button" ? (
          <button key={action.id} onClick={action.onClick}>
            {action.label}
          </button>
        ) : null
      )}
    </header>
  ),
}))
vi.mock("@/components/ArticleGrid", () => ({
  ArticleGrid: ({ articles, emptyState }: any) =>
    articles.length ? (
      <div>{articles.map((article: any) => article.title).join(",")}</div>
    ) : (
      (emptyState ?? <p>Empty</p>)
    ),
}))
afterEach(() => { cleanup(); mocks.refreshing = false; vi.clearAllMocks() })

function TestQueries({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
}

const article: ArticleRow = {
  id: "a1",
  title: "Old saved article",
  feedId: "f1",
  description: null,
  link: "https://example.test",
  image: null,
  publishedAt: "2020-01-01",
  isUsed: false,
  visitCount: 0,
  isBookmarked: false,
  isReadLater: false,
  isFavorite: false,
}
const data = {
  folders: [],
  feeds: [
    {
      id: "f1",
      name: "Original feed",
      url: "https://example.test",
      folderId: null,
      lastFetchedAt: "2026-01-01T00:00:00Z",
    },
  ],
  articles: [article],
}
describe("RSSShell loader data", () => {
  it("uses a dismissible loading toast without inserting a page-shifting status row", () => {
    mocks.refreshing = true
    const { unmount } = render(<RSSShell initialData={data} title="Home" showRefreshControls><p>Briefing</p></RSSShell>, { wrapper: TestQueries })
    expect(mocks.loading).toHaveBeenCalledWith("Checking sources for new articles…", { description: "You can keep reading." })
    expect(screen.queryByText(/Checking sources for new articles/)).toBeNull()
    expect(screen.getByText("Briefing")).toBeTruthy()
    unmount()
    expect(mocks.dismiss).toHaveBeenCalledWith("refresh-toast")
  })
  it("renders new loader data without a remount or a second fetch", () => {
    const { rerender } = render(
      <RSSShell initialData={data} title="All articles" skipDateFilter />,
      { wrapper: TestQueries }
    )
    expect(screen.getByText("Old saved article")).toBeTruthy()
    rerender(
      <RSSShell
        initialData={{
          ...data,
          feeds: [{ ...data.feeds[0], name: "Updated feed" }],
          articles: [{ ...article, title: "Fresh result" }],
        }}
        title="All articles"
        skipDateFilter
      />
    )
    expect(screen.getByText("Updated feed")).toBeTruthy()
    expect(screen.getByText("Fresh result")).toBeTruthy()
    expect(screen.queryByText("Old saved article")).toBeNull()
  })
  it("explains date-filter emptiness and offers a one-click reset", () => {
    render(<RSSShell initialData={data} title="All articles" />, { wrapper: TestQueries })
    expect(screen.getByText("No articles match your date range.")).toBeTruthy()
    fireEvent.click(
      screen.getByRole("button", {
        name: "Clear filters and show saved articles",
      })
    )
    expect(screen.getByText("Old saved article")).toBeTruthy()
  })
  it("shows refresh controls in the Home header", () => {
    render(
      <RSSShell initialData={data} title="Home" showRefreshControls>
        <p>Briefing</p>
      </RSSShell>,
      { wrapper: TestQueries }
    )
    expect(screen.getByText(/^Updated /)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Refresh all feeds" }))
    expect(mocks.refresh).toHaveBeenCalledOnce()
  })
})
