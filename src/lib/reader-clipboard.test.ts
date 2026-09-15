// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest"
import { writeReaderClipboard } from "./reader-clipboard"

afterEach(() => vi.unstubAllGlobals())
it("starts a single dual-format write immediately before conversion resolves", async () => {
  let resolve!: (value: { html: string; markdown: string }) => void
  const payload = new Promise<{ html: string; markdown: string }>((done) => {
    resolve = done
  })
  const write = vi.fn().mockResolvedValue(undefined)
  const item = vi.fn(function (this: object, values: object) {
    Object.assign(this, values)
  })
  vi.stubGlobal("ClipboardItem", item)
  vi.stubGlobal("navigator", { clipboard: { write } })
  const result = writeReaderClipboard(payload)
  expect(write).toHaveBeenCalledTimes(1)
  expect(Object.keys(item.mock.calls[0][0])).toEqual([
    "text/html",
    "text/plain",
  ])
  resolve({ html: "<p>Body</p>", markdown: "Body" })
  expect(await result).toBe("rich")
})
it("falls back to Markdown on text-only platforms", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal("ClipboardItem", undefined)
  vi.stubGlobal("navigator", { clipboard: { writeText } })
  expect(
    await writeReaderClipboard(
      Promise.resolve({ html: "<b>Body</b>", markdown: "**Body**" })
    )
  ).toBe("markdown")
  expect(writeText).toHaveBeenCalledWith("**Body**")
})
it("reports denied writes instead of silently doing another write", async () => {
  vi.stubGlobal("ClipboardItem", class {})
  const writeText = vi.fn()
  vi.stubGlobal("navigator", {
    clipboard: {
      write: vi.fn().mockRejectedValue(new Error("denied")),
      writeText,
    },
  })
  await expect(
    writeReaderClipboard(Promise.resolve({ html: "", markdown: "" }))
  ).rejects.toThrow("denied")
  expect(writeText).not.toHaveBeenCalled()
})
