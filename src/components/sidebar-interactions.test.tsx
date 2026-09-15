// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ChatHistory } from "./ai/history/ChatHistory"
import { NavFolders } from "./nav-folders"
import type { ReactNode } from "react"

const mock = vi.hoisted(() => ({
  pathname: "/discover", navigate: vi.fn(), mobile: false, closeMobile: vi.fn(), state: "expanded",
  history: { threads: [] as Array<{ id: string; title: string; preview: string; updatedAt: string; messageCount: number }>, loading: false, error: false, refresh: vi.fn(), rename: vi.fn(), remove: vi.fn() },
}))
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mock.navigate,
  useRouterState: (options?: { select?: (state: unknown) => unknown }) => {
    const state = { location: { pathname: mock.pathname } }
    return options?.select ? options.select(state) : state
  },
  Link: ({ to, params, children, onClick, ...props }: any) => {
    const href = Object.entries(params ?? {}).reduce((path: string, [key, value]) => path.replace(`$${key}`, String(value)), to)
    return <a href={href} {...props} onClick={(e) => { e.preventDefault(); onClick?.(e); mock.navigate({ to: href }) }}>{children}</a>
  },
}))
vi.mock("@/components/ui/sidebar", () => ({ useSidebar: () => ({ state: mock.state, isMobile: mock.mobile, setOpenMobile: mock.closeMobile }) }))
vi.mock("@/components/ai/history/use-chat-history", () => ({ useChatHistory: () => mock.history, shortAge: () => "1h" }))
vi.mock("@/lib/demo", () => ({ DEMO_MODE: false }))
vi.mock("@/hooks/guest-share-context", () => ({ useGuestShare: () => null }))
vi.mock("@/components/command/command-palette-context", () => ({ useCommandAction: () => {} }))
vi.mock("@/server/rss", () => ({ deleteFeed: vi.fn(), deleteFolder: vi.fn(), renameFolder: vi.fn() }))
vi.mock("@/components/AddFolderModal", () => ({ AddFolderModal: () => null }))
vi.mock("@/components/FolderShareModal", () => ({ FolderShareModal: () => null }))
vi.mock("@/components/folder/ManageModal", () => ({ ManageModal: () => null }))
vi.mock("@/components/ui/context-menu", () => ({
  ContextMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  ContextMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  ContextMenuContent: () => null, ContextMenuItem: () => null, ContextMenuSeparator: () => null,
}))

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  mock.pathname = "/discover"
  mock.mobile = false
  mock.state = "expanded"
  mock.history.loading = false
  mock.history.error = false
  mock.history.threads = [{ id: "cht_test", title: "Research roundup", preview: "Sources", updatedAt: "2026-09-15", messageCount: 2 }]
})
afterEach(cleanup)

function folders() {
  return <NavFolders folders={[{ id: "folder1", name: "Research" }]} feeds={[{ id: "feed1", name: "Lab news", url: "https://example.test/rss", folderId: "folder1" }]} articleCounts={{ feed1: 8 }} folderArticleCounts={{ folder1: 8 }} onFolderCreated={vi.fn()} onEditFeed={vi.fn()} />
}

describe("sidebar navigation and disclosure", () => {
  it("toggles a folder once without navigating and keeps the folder link independent", async () => {
    render(folders())
    fireEvent.click(screen.getByRole("button", { name: "Expand Research" }))
    expect(screen.getByRole("button", { name: "Collapse Research" }).getAttribute("aria-expanded")).toBe("true")
    expect(screen.getByRole("link", { name: /Lab news/ })).toBeTruthy()
    expect(mock.navigate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Collapse Research" }))
    await waitFor(() => expect(screen.queryByRole("link", { name: /Lab news/ })).toBeNull())
    fireEvent.click(screen.getByRole("link", { name: /Research/ }))
    expect(mock.navigate).toHaveBeenCalledWith({ to: "/research" })
    expect(screen.getByRole("button", { name: "Expand Research" })).toBeTruthy()
  })

  it("reveals a directly selected feed and keeps its parent quiet", () => {
    mock.pathname = "/research/lab-news"
    render(folders())
    expect(screen.getByRole("button", { name: "Collapse Research" })).toBeTruthy()
    expect(screen.getByRole("link", { name: /Lab news/ }).getAttribute("aria-current")).toBe("page")
    expect(screen.getByRole("link", { name: /Research/ }).getAttribute("aria-current")).toBeNull()
  })

  it("collapses history without navigation and remembers the preference after remount", () => {
    const view = render(<ChatHistory />)
    expect(screen.queryByText("History")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Collapse chat history" }))
    expect(mock.navigate).not.toHaveBeenCalled()
    view.unmount()
    render(<ChatHistory />)
    expect(screen.getByRole("button", { name: "Expand chat history" }).getAttribute("aria-expanded")).toBe("false")
    fireEvent.click(screen.getByRole("link", { name: "Spark AI, new chat" }))
    expect(mock.navigate).toHaveBeenCalledWith({ to: "/dashboard/ai" })
  })

  it("shows loading, failure with retry, and empty states separately", () => {
    mock.history.threads = []
    mock.history.loading = true
    const view = render(<ChatHistory />)
    expect(screen.getByText("Loading chats…")).toBeTruthy()
    expect(screen.queryByText("No chats yet")).toBeNull()
    mock.history.loading = false
    mock.history.error = true
    view.rerender(<ChatHistory />)
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(mock.history.refresh).toHaveBeenCalledOnce()
    expect(screen.queryByText("No chats yet")).toBeNull()
    mock.history.error = false
    view.rerender(<ChatHistory />)
    expect(screen.getByText("No chats yet")).toBeTruthy()
  })

  it("searches long histories and closes the mobile sidebar only on navigation", () => {
    mock.mobile = true
    mock.state = "collapsed"
    mock.history.threads = Array.from({ length: 8 }, (_, i) => ({ id: `cht_${i}`, title: `Chat ${i}`, preview: "", updatedAt: "2026-09-15", messageCount: 1 }))
    render(<ChatHistory />)
    fireEvent.change(screen.getByRole("textbox", { name: "Search chats" }), { target: { value: "Chat 3" } })
    expect(screen.queryByRole("link", { name: /Chat 2/ })).toBeNull()
    expect(mock.closeMobile).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("link", { name: /Chat 3/ }))
    expect(mock.closeMobile).toHaveBeenCalledWith(false)
    expect(mock.navigate).toHaveBeenCalledWith({ to: "/dashboard/ai/cht_3" })
  })

  it("exposes rename actions without requiring hover, and cancel does not save", async () => {
    render(<ChatHistory />)
    fireEvent.click(screen.getByRole("button", { name: "Actions for Research roundup" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename" }))
    const input = screen.getByRole("textbox", { name: "Conversation title" })
    fireEvent.change(input, { target: { value: "Changed" } })
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(mock.history.rename).not.toHaveBeenCalled()
    expect(screen.getByRole("link", { name: /Research roundup/ })).toBeTruthy()
  })
  it("keeps an expanded folder when the sidebar remounts on another page", () => {
    const view = render(folders())
    fireEvent.click(screen.getByRole("button", { name: "Expand Research" }))
    view.unmount()
    mock.pathname = "/today"
    render(folders())
    expect(screen.getByRole("button", { name: "Collapse Research" }).getAttribute("aria-expanded")).toBe("true")
  })

  it("offers saved conversations in the collapsed rail", async () => {
    mock.state = "collapsed"
    render(<ChatHistory />)
    expect(screen.getByRole("link", { name: "Spark AI, new chat" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Chat history" }))
    expect(await screen.findByRole("link", { name: /Research roundup/ })).toBeTruthy()
  })

  it("recognizes legacy conversation IDs as the active conversation", () => {
    mock.pathname = "/dashboard/ai/__LOCALID_legacy123"
    mock.history.threads[0].id = "__LOCALID_legacy123"
    render(<ChatHistory />)
    expect(screen.getByRole("link", { name: /Research roundup/ }).getAttribute("aria-current")).toBe("page")
  })

})
