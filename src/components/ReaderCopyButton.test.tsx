// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { ReaderCopyButton } from "./ReaderCopyButton"
import { TooltipProvider } from "./ui/tooltip"

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), write: vi.fn() }))
vi.mock("@/lib/reader-clipboard", () => ({
  prepareReaderExport: mocks.prepare,
  writeReaderClipboard: mocks.write,
}))
const input = {
  title: "Title",
  url: "https://example.com",
  html: "<p>Body</p>",
}
const renderButton = (disabled = false) =>
  render(
    <TooltipProvider>
      <ReaderCopyButton input={input} disabled={disabled} gutter={false} />
    </TooltipProvider>
  )
beforeEach(() => {
  mocks.prepare
    .mockReset()
    .mockResolvedValue({ html: "<p>Body</p>", markdown: "Body" })
  mocks.write.mockReset().mockResolvedValue("rich")
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
it("announces success only after the write resolves and prevents repeat writes", async () => {
  let resolve!: (value: string) => void
  mocks.write.mockReturnValue(
    new Promise((done) => {
      resolve = done
    })
  )
  renderButton()
  fireEvent.click(screen.getByRole("button", { name: "Copy article" }))
  fireEvent.click(screen.getByRole("button", { name: "Copy article" }))
  expect(mocks.write).toHaveBeenCalledTimes(1)
  expect(screen.getByRole("status").textContent).toBe("")
  resolve("rich")
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain("Article copied")
  )
})
it("provides prepared Markdown and a fresh-click retry after failure", async () => {
  mocks.write.mockRejectedValue(new Error("denied"))
  const writeText = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } })
  renderButton()
  fireEvent.click(screen.getByRole("button", { name: "Copy article" }))
  expect(
    await screen.findByRole("textbox", { name: "Article Markdown" })
  ).toHaveProperty("value", "Body")
  fireEvent.click(screen.getByRole("button", { name: "Copy Markdown" }))
  await waitFor(() => expect(writeText).toHaveBeenCalledWith("Body"))
})
it("does not prepare unavailable content", () => {
  renderButton(true)
  fireEvent.click(screen.getByRole("button", { name: /not available/ }))
  expect(mocks.prepare).not.toHaveBeenCalled()
})
it("ignores completion after the article unmounts", async () => {
  let reject!: (error: Error) => void
  mocks.write.mockReturnValue(
    new Promise((_done, fail) => {
      reject = fail
    })
  )
  const view = renderButton()
  fireEvent.click(screen.getByRole("button", { name: "Copy article" }))
  view.unmount()
  reject(new Error("denied"))
  await Promise.resolve()
  expect(screen.queryByRole("dialog")).toBeNull()
})
