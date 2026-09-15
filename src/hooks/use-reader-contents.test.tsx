// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  collectReaderHeadings,
  currentReaderSection,
  readerContentsLayout,
  readerProgress,
  useReaderContents,
} from "./use-reader-contents"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("reader outline", () => {
  it("keeps H2/H3 in document order, omits H1/deeper/empty headings and preserves publisher anchors", () => {
    const prose = document.createElement("div")
    prose.innerHTML =
      '<h1>Article title</h1><h2 id="same"> First <em>section</em> </h2><h3 id="same"> First section </h3><h4>Detail</h4><h2> </h2><h2 hidden>Hidden</h2><h3>No ID</h3>'
    const before = prose.innerHTML
    const outline = collectReaderHeadings(prose)
    expect(outline.map((entry) => entry.title)).toEqual([
      "Introduction",
      "First section",
      "First section",
      "No ID",
    ])
    expect(new Set(outline.map((entry) => entry.key)).size).toBe(4)
    expect(outline[1].element).not.toBe(outline[2].element)
    expect(prose.innerHTML).toBe(before)
  })
  it("does not invent sections for plain text or an H1-only article", () => {
    const prose = document.createElement("div")
    prose.innerHTML = "<h1>Title</h1><p><strong>Not a heading</strong></p>"
    expect(collectReaderHeadings(prose)).toEqual([])
  })
  it("tracks both directions at the reading line and keeps the final section active at the end", () => {
    const offsets = [300, 800, 1600]
    expect(currentReaderSection(offsets, 0, 600, 2000)).toBe(0)
    expect(currentReaderSection(offsets, 204, 600, 2000)).toBe(1)
    expect(currentReaderSection(offsets, 900, 600, 2000)).toBe(2)
    expect(currentReaderSection(offsets, 300, 600, 2000)).toBe(1)
    expect(currentReaderSection(offsets, 1400, 600, 2000)).toBe(3)
    expect(currentReaderSection([300], 0, 600, 400)).toBe(0)
  })
  it.each([
    [0, false, false, true, 300, "hidden"],
    [4, false, false, true, 240, "expanded"],
    [4, false, false, true, 239, "compact"],
    [4, false, true, true, 300, "compact"],
    [4, false, true, false, 300, "hidden"],
    [4, true, false, false, 24, "mobile"],
    [4, true, true, true, 24, "hidden"],
  ] as const)(
    "selects the layout for headings=%s, mobile=%s, Zen=%s, long=%s, gutter=%s",
    (count, mobile, zen, long, gutter, result) => {
      expect(readerContentsLayout(count, mobile, zen, long, gutter)).toBe(
        result
      )
    }
  )
})

describe("reader scroll lifecycle", () => {
  let resizeCallbacks: Array<() => void>
  beforeEach(() => {
    vi.useFakeTimers()
    resizeCallbacks = []
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) =>
      setTimeout(callback, 0)
    )
    vi.stubGlobal("cancelAnimationFrame", clearTimeout)
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resizeCallbacks.push(callback)
        }
        observe() {}
        disconnect() {}
      }
    )
    vi.stubGlobal("matchMedia", () => ({ matches: true }))
  })
  function setup() {
    const scroll = document.createElement("div")
    const article = document.createElement("div")
    const prose = document.createElement("div")
    prose.innerHTML =
      '<h2 id="duplicate">First</h2><h3 id="duplicate">Second</h3>'
    article.append(prose)
    scroll.append(article)
    let contentHeight = 2000
    let firstOffset = 300
    const rect = (top: number, left = 0, height = 0) => ({
      top,
      bottom: top + height,
      left,
      height,
      width: 600,
      right: left + 600,
      x: left,
      y: top,
      toJSON() {},
    })
    scroll.getBoundingClientRect = () => rect(100)
    article.getBoundingClientRect = () =>
      rect(140 - scroll.scrollTop, 260, contentHeight)
    prose.getBoundingClientRect = () =>
      rect(200 - scroll.scrollTop, 260, contentHeight - 60)
    Object.defineProperty(scroll, "clientHeight", {
      value: 600,
      configurable: true,
    })
    const elements = prose.querySelectorAll<HTMLElement>("h2,h3")
    elements[0].getBoundingClientRect = () =>
      rect(100 + firstOffset - scroll.scrollTop)
    elements[1].getBoundingClientRect = () => rect(1100 - scroll.scrollTop)
    scroll.scrollTo = vi.fn((options: ScrollToOptions | number) => {
      scroll.scrollTop = (options as ScrollToOptions).top ?? 0
      scroll.dispatchEvent(new Event("scroll"))
    }) as typeof scroll.scrollTo
    const hook = renderHook(({ key }) => useReaderContents(key), {
      initialProps: { key: "first" },
    })
    act(() => {
      hook.result.current.scrollRef(scroll)
      hook.result.current.articleRef(article)
      hook.result.current.proseRef(prose)
    })
    return {
      ...hook,
      scroll,
      prose,
      setHeight: (value: number) => {
        contentHeight = value
      },
      setOffset: (value: number) => {
        firstOffset = value
      },
    }
  }
  it("updates progress within a long section and navigates to exact page fractions", () => {
    const { result, scroll } = setup()
    act(() => {
      result.current.navigateProgress(0.25)
      vi.runAllTimers()
    })
    expect(scroll.scrollTo).toHaveBeenLastCalledWith({
      top: 360,
      behavior: "instant",
    })
    expect(result.current.progress).toBe(0.25)
    expect(result.current.activeIndex).toBe(1)
    act(() => {
      result.current.navigateProgress(0.5)
      vi.runAllTimers()
    })
    expect(result.current.progress).toBe(0.5)
    expect(result.current.activeIndex).toBe(1)
    expect(result.current.progressTitles).toHaveLength(21)
  })
  it("navigates to the correct duplicate ID element and back to Introduction with reduced motion", () => {
    const { result, scroll } = setup()
    expect(result.current.isLong).toBe(true)
    act(() => {
      result.current.navigate(2)
      vi.runAllTimers()
    })
    expect(scroll.scrollTo).toHaveBeenLastCalledWith({
      top: 904,
      behavior: "instant",
    })
    expect(result.current.activeIndex).toBe(2)
    act(() => {
      result.current.navigate(0)
      vi.runAllTimers()
    })
    expect(scroll.scrollTop).toBe(0)
    expect(result.current.activeIndex).toBe(0)
  })
  it("remeasures after image loading, font/layout changes and resizing", () => {
    const { result, scroll, setHeight, setOffset } = setup()
    act(() => {
      scroll.scrollTop = 300
      scroll.dispatchEvent(new Event("scroll"))
      vi.runAllTimers()
    })
    expect(result.current.activeIndex).toBe(1)
    act(() => {
      setOffset(700)
      scroll.dispatchEvent(new Event("load"))
      vi.runAllTimers()
    })
    expect(result.current.activeIndex).toBe(0)
    act(() => {
      setHeight(1200)
      resizeCallbacks.forEach((callback) => callback())
      vi.runAllTimers()
    })
    expect(result.current.isLong).toBe(false)
    act(() => {
      setHeight(1800)
      resizeCallbacks.forEach((callback) => callback())
      vi.runAllTimers()
    })
    expect(result.current.isLong).toBe(true)
  })
  it("clears headings when Reader unmounts, and rebuilds after content replacement", () => {
    const { result, prose, rerender, unmount } = setup()
    act(() => result.current.proseRef(null))
    expect(result.current.headings).toEqual([])
    prose.innerHTML = "<h2>Replacement</h2>"
    act(() => result.current.proseRef(prose))
    rerender({ key: "replacement" })
    expect(result.current.headings.map((entry) => entry.title)).toEqual([
      "Introduction",
      "Replacement",
    ])
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

it("measures progress by scroll distance, including quarters and thirds", () => {
  for (const fraction of [0, 0.25, 1 / 3, 0.5, 2 / 3, 0.75, 1]) {
    expect(readerProgress(2400 * fraction, 3000, 600)).toBeCloseTo(fraction)
  }
  expect(readerProgress(-20, 3000, 600)).toBe(0)
  expect(readerProgress(2700, 3000, 600)).toBe(1)
  expect(readerProgress(0, 400, 600)).toBe(0)
})
