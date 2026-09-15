// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest"
import { handleReaderMediaError } from "./reader-media"

afterEach(() => document.body.replaceChildren())

it("retries the fallback image once, then preserves alt text and subsequent content", () => {
  document.body.innerHTML =
    '<picture><source srcset="https://example.com/broken.webp"><img src="https://example.com/fallback.png" alt="A useful diagram"></picture><h2>Following section</h2>'
  const image = document.querySelector("img")!
  handleReaderMediaError(image, "https://example.com/article")
  expect(document.querySelector("source")).toBeNull()
  expect(document.querySelector(".reader-media-fallback")).toBeNull()
  handleReaderMediaError(image, "https://example.com/article")
  handleReaderMediaError(image, "https://example.com/article")
  expect(document.querySelectorAll(".reader-media-fallback")).toHaveLength(1)
  expect(
    document.querySelector(".reader-media-fallback")?.textContent
  ).toContain("A useful diagram")
  expect(document.querySelector("a")?.href).toBe("https://example.com/article")
  expect(document.querySelector("h2")?.textContent).toBe("Following section")
  expect(image.hidden).toBe(true)
})

it("handles failed audio without discarding the article or interpreting alt text as HTML", () => {
  document.body.innerHTML =
    '<audio src="https://example.com/voice.mp3"></audio><p>After audio</p><img>'
  handleReaderMediaError(
    document.querySelector("audio"),
    "https://example.com/article"
  )
  const image = document.querySelector("img")!
  image.alt = "<script>bad()</script>"
  handleReaderMediaError(image, "https://example.com/article")
  expect(document.querySelector("script")).toBeNull()
  expect(document.body.textContent).toContain("After audio")
  expect(document.body.textContent).toContain("Media unavailable")
})
