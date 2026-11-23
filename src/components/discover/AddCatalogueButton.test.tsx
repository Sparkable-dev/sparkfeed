// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { AddCatalogueButton } from "./AddCatalogueButton"
import { SourceTitle } from "./SourceTitle"
import { TooltipProvider } from "@/components/ui/tooltip"

const mocks = vi.hoisted(() => ({ add: vi.fn(), imported: vi.fn() }))
vi.mock("@/server/catalogue", () => ({
  importCatalogueItem: mocks.add,
  getImportStatus: vi.fn(),
}))
vi.mock("@/lib/demo", () => ({ DEMO_MODE: false }))
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }))
vi.mock("@/components/WorkspaceDataProvider", () => ({
  useWorkspaceNavigation: () => ({
    data: { folders: [{ id: "folder-1", name: "Research" }] },
  }),
}))
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))
beforeEach(() => {
  vi.clearAllMocks()
  mocks.add.mockResolvedValue({
    status: "ok",
    added: 1,
    skipped: 0,
    feedIds: ["feed-1"],
    folderId: null,
  })
})
afterEach(cleanup)
function mount() {
  return render(
    <AddCatalogueButton
      kind="feed"
      slug="anthropic"
      label="Add"
      alreadyAdded={false}
      onImported={mocks.imported}
    />
  )
}
it("adds without a folder when the primary action is clicked", async () => {
  mount()
  fireEvent.click(screen.getByRole("button", { name: /^Add$/ }))
  await waitFor(() =>
    expect(mocks.add).toHaveBeenCalledWith({
      data: { kind: "feed", slug: "anthropic", destination: { kind: "none" } },
    })
  )
})
it("adds to the selected workspace folder", async () => {
  mount()
  fireEvent.click(screen.getByRole("button", { name: "Add to folder" }))
  fireEvent.click(await screen.findByRole("menuitem", { name: "Research" }))
  await waitFor(() =>
    expect(mocks.add).toHaveBeenCalledWith({
      data: {
        kind: "feed",
        slug: "anthropic",
        destination: { kind: "existing", folderId: "folder-1" },
      },
    })
  )
})
it("creates a folder and imports in one request", async () => {
  mount()
  fireEvent.click(screen.getByRole("button", { name: "Add to folder" }))
  fireEvent.click(
    await screen.findByRole("menuitem", { name: "Create folder…" })
  )
  fireEvent.change(await screen.findByLabelText("Folder name"), {
    target: { value: "My research" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Create and add" }))
  await waitFor(() =>
    expect(mocks.add).toHaveBeenCalledWith({
      data: {
        kind: "feed",
        slug: "anthropic",
        destination: { kind: "new", name: "My research" },
      },
    })
  )
})
it("keeps the source name as an external link without opening the parent card", () => {
  const parent = vi.fn()
  render(
    <TooltipProvider>
      <div onClick={parent}>
        <SourceTitle name="Anthropic News" url="https://anthropic.com/news" />
      </div>
    </TooltipProvider>
  )
  const link = screen.getByRole("link", { name: "Anthropic News" })
  expect(link.getAttribute("href")).toBe("https://anthropic.com/news")
  expect(link.getAttribute("target")).toBe("_blank")
  fireEvent.click(link)
  expect(parent).not.toHaveBeenCalled()
})
