// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest"
import { useReaderPrefs } from "./readerPrefs"

afterEach(() => {
  localStorage.clear()
  useReaderPrefs.setState({
    zenMode: false,
    theme: "dark",
    fontScale: 1,
    width: "narrow",
  })
})

it("hydrates older preferences with Zen off without losing existing choices", async () => {
  localStorage.setItem(
    "rss-reader-prefs",
    JSON.stringify({
      state: { fontScale: 1.3, width: "wide", theme: "sepia" },
      version: 0,
    })
  )
  await useReaderPrefs.persist.rehydrate()
  expect(useReaderPrefs.getState()).toMatchObject({
    fontScale: 1.3,
    width: "wide",
    theme: "sepia",
    zenMode: false,
  })
})

it("persists the Zen setting alongside reader preferences", async () => {
  useReaderPrefs.getState().setZenMode(true)
  expect(
    JSON.parse(localStorage.getItem("rss-reader-prefs")!).state.zenMode
  ).toBe(true)
  await useReaderPrefs.persist.rehydrate()
  expect(useReaderPrefs.getState().zenMode).toBe(true)
})
