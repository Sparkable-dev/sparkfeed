// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { SparkChart } from "../SparkChart"

/**
 * A chart has to be readable back to a number.
 *
 * The first version drew a purple shape and nothing else — no scale, no dates,
 * no counts — and the verdict on it was "kinda useless, no metrics or numbers".
 * These pin the numbers, because they are the difference between a chart and a
 * decoration and there is nothing in the markup that would fail loudly if they
 * disappeared again.
 */

afterEach(cleanup)

const days = [
  { label: "Mon", value: 4 },
  { label: "Tue", value: 20 },
  { label: "Wed", value: 9 },
]

describe("a series", () => {
  it("carries a scale, the ends of the range, and the peak", () => {
    render(<SparkChart shape="series" points={days} />)

    // The axis: top, middle, zero.
    expect(screen.getByText("20")).toBeTruthy()
    expect(screen.getByText("10")).toBeTruthy()
    expect(screen.getByText("0")).toBeTruthy()

    expect(screen.getByText("Mon")).toBeTruthy()
    expect(screen.getByText("Wed")).toBeTruthy()
    expect(screen.getByText(/peak 20 · Tue/)).toBeTruthy()
  })

  it("says so rather than drawing an empty box", () => {
    render(<SparkChart shape="series" points={[]} />)
    expect(screen.getByText("Nothing to plot yet.")).toBeTruthy()
  })
})

describe("a ranking", () => {
  it("gives every bar its count and its share of the total", () => {
    render(
      <SparkChart
        shape="bars"
        points={[
          { label: "News from Google", value: 103 },
          { label: "Other feeds", value: 53 },
        ]}
      />
    )

    expect(screen.getByText("News from Google")).toBeTruthy()
    expect(screen.getByText("66%")).toBeTruthy()
    expect(screen.getByText("34%")).toBeTruthy()
  })
})

describe("colour", () => {
  it("draws a bar at full strength inside its dimmed track", () => {
    // The bug that survived brightening the accent: `opacity` on the track
    // applies to the whole subtree, so the bar inside it was rendered at 14%
    // whatever colour it was given.
    const { container } = render(
      <SparkChart
        shape="bars"
        points={[{ label: "News", value: 10 }]}
        accent="rgb(1, 2, 3)"
      />
    )

    const bar = container.querySelector<HTMLElement>(
      '[style*="rgb(1, 2, 3)"]'
    )
    expect(bar).toBeTruthy()

    // No ancestor may fade it.
    for (let el = bar!.parentElement; el; el = el.parentElement) {
      const faded = el.style.opacity
      expect(faded === "" || Number(faded) === 1).toBe(true)
    }
  })

  it("paints the mark and leaves the labels alone", () => {
    // The bug: the whole chart was wrapped in one colour, so folder names came
    // out as low-contrast purple — the least legible text on the card, and the
    // part that carries the meaning.
    const { container } = render(
      <SparkChart shape="series" points={days} accent="rgb(1, 2, 3)" />
    )

    const marks = container.querySelectorAll('path[stroke="rgb(1, 2, 3)"]')
    expect(marks.length).toBeGreaterThan(0)

    const label = screen.getByText("Mon")
    expect(label.getAttribute("style") ?? "").not.toContain("rgb(1, 2, 3)")
  })
})
