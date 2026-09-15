// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import userEvent from "@testing-library/user-event"
import { ReaderContents } from "./ReaderContents"
import { Sheet, SheetContent, SheetTitle } from "./ui/sheet"

const headings = [
  "Introduction",
  "First section",
  "Second section",
  "Third section",
  "Fourth section",
  "Fifth section",
].map((title, index) => ({ key: String(index), title, element: null }))
const navigate = vi.fn()
const props = {
  headings,
  progress: 0,
  progressTitles: Array.from({ length: 21 }, () => "First section"),
  navigateProgress: vi.fn(),
  activeIndex: 2,
  gutter: 300,
  height: 800,
  centerY: 500,
  mobile: false,
  isLong: true,
  zenMode: false,
  theme: "dark" as const,
  navigate,
}

beforeEach(() => {
  vi.clearAllMocks()
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
  HTMLElement.prototype.scrollTo = vi.fn(function (
    this: HTMLElement,
    options: ScrollToOptions | number
  ) {
    this.scrollTop = (options as ScrollToOptions).top ?? 0
  }) as typeof HTMLElement.prototype.scrollTo
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("reader contents controls", () => {
  it("shows five neighbors with current-section semantics and full titles on focus", () => {
    render(<ReaderContents {...props} />)
    const nav = screen.getByRole("navigation", { name: "Article contents" })
    expect(within(nav).getAllByRole("button")).toHaveLength(5)
    const current = within(nav).getByRole("button", { name: "Second section" })
    expect(current.getAttribute("aria-current")).toBe("location")
    fireEvent.focus(current)
    expect(screen.getByRole("tooltip").textContent).toBe("Second section")
    fireEvent.click(within(nav).getByRole("button", { name: "Fourth section" }))
    expect(navigate).toHaveBeenCalledWith(4)
  })
  it("switches between compact and hidden Zen layouts, without navigating", () => {
    const { rerender } = render(<ReaderContents {...props} zenMode />)
    expect(screen.getByRole("navigation").getAttribute("data-layout")).toBe(
      "compact"
    )
    expect(screen.getAllByRole("button")).toHaveLength(21)
    rerender(<ReaderContents {...props} zenMode isLong={false} />)
    expect(screen.queryByRole("navigation")).toBeNull()
    rerender(<ReaderContents {...props} zenMode mobile />)
    expect(screen.queryByRole("navigation")).toBeNull()
    expect(navigate).not.toHaveBeenCalled()
  })
  it("opens the mobile outline at the current heading and returns focus when dismissed", async () => {
    const user = userEvent.setup()
    render(<ReaderContents {...props} mobile />)
    const trigger = screen.getByRole("button", {
      name: /Open article contents/,
    })
    await user.click(trigger)
    const dialog = await screen.findByRole("dialog", {
      name: "Article contents",
    })
    const current = within(dialog).getByRole("button", {
      name: "Second section",
    })
    await waitFor(() => expect(document.activeElement).toBe(current))
    expect(
      dialog.querySelector(".reader-contents-dialog-list")?.scrollTop
    ).toBe(96)
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(document.activeElement).toBe(trigger)
    expect(navigate).not.toHaveBeenCalled()
  })
  it("navigates after selection and closes only the nested contents dialog", async () => {
    const user = userEvent.setup()
    const closeReader = vi.fn()
    render(
      <Sheet open onOpenChange={closeReader}>
        <SheetContent>
          <SheetTitle>Reader</SheetTitle>
          <ReaderContents {...props} mobile />
        </SheetContent>
      </Sheet>
    )
    await user.click(
      screen.getByRole("button", { name: /Open article contents/ })
    )
    const dialog = await screen.findByRole("dialog", {
      name: "Article contents",
    })
    expect(document.querySelector(".reader-contents-backdrop")).not.toBeNull()
    await user.click(
      within(dialog).getByRole("button", { name: "Fourth section" })
    )
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(4))
    expect(screen.getByRole("dialog", { name: "Reader" })).toBeTruthy()
    expect(closeReader).not.toHaveBeenCalled()
  })
})

it("maps Zen marks to page fractions without changing the non-Zen outline", () => {
  const { rerender } = render(
    <ReaderContents {...props} zenMode progress={0.25} />
  )
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
    "25"
  )
  expect(
    screen
      .getByRole("button", { name: "25% · First section" })
      .hasAttribute("data-current")
  ).toBe(true)
  fireEvent.click(screen.getByRole("button", { name: "75% · First section" }))
  fireEvent.mouseEnter(screen.getByRole("button", { name: "75% · First section" }))
  expect(screen.getByRole("tooltip").textContent).toBe("First section")
  expect(props.navigateProgress).toHaveBeenCalledWith(0.75)
  rerender(<ReaderContents {...props} zenMode progress={0.75} />)
  expect(
    screen
      .getByRole("button", { name: "75% · First section" })
      .hasAttribute("data-current")
  ).toBe(true)
  rerender(<ReaderContents {...props} progress={0.75} />)
  expect(screen.queryByRole("progressbar")).toBeNull()
  expect(
    screen
      .getByRole("button", { name: "Second section" })
      .getAttribute("aria-current")
  ).toBe("location")
  expect(screen.getAllByRole("button")).toHaveLength(5)
})
