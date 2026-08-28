// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import { SourcesOverview } from "../SourcesOverview"
import type { SourcesOverview as Overview } from "../source-stats"

/**
 * The strip above the table.
 *
 * What is pinned here is that it reports on the collection rather than
 * decorating it: the counts are on screen as numbers, every source appears in
 * the plot, and a source that has stopped is named as such. A chart nobody can
 * read a figure off is the thing this page was asked not to grow.
 */

afterEach(cleanup)

const OVERVIEW: Overview = {
  feedCount: 4,
  folderCount: 2,
  posts30d: 120,
  byStatus: { active: 2, quiet: 1, broken: 1, new: 0 },
  byFolder: [
    { label: "Google", value: 100 },
    { label: "Other feeds", value: 20 },
  ],
  points: [
    { id: "a", name: "News from Google", posts30d: 90, quietDays: 0, status: "active" },
    { id: "b", name: "Waze", posts30d: 10, quietDays: 1, status: "active" },
    { id: "c", name: "Security", posts30d: 18, quietDays: 20, status: "quiet" },
    { id: "d", name: "Dev Blog", posts30d: 2, quietDays: null, status: "broken" },
  ],
}

describe("the overview strip", () => {
  it("leads with the counts, not with a shape", () => {
    render(<SourcesOverview overview={OVERVIEW} />)

    expect(screen.getByText("4")).toBeTruthy()
    expect(screen.getByText("sources")).toBeTruthy()
    expect(screen.getByText(/across 2 folders/)).toBeTruthy()
    // Broken plus quiet, called out where it can be acted on.
    expect(screen.getByText("2 need a look")).toBeTruthy()
    expect(screen.getByText(/120 in 30d/)).toBeTruthy()
  })

  it("gives the health meter a text equivalent", () => {
    // It is a row of coloured strips and nothing else; without this it says
    // nothing at all to a screen reader.
    render(<SourcesOverview overview={OVERVIEW} />)
    expect(
      screen.getByLabelText("2 active, 1 quiet, 1 not fetching"),
    ).toBeTruthy()
  })

  it("plots every source, including one that has never posted", () => {
    render(<SourcesOverview overview={OVERVIEW} />)

    const plot = screen.getByRole("img", { name: /4 sources by volume and silence/ })
    // The dots are the only things in the plot that are both positioned and
    // titled — the dividers carry a position and no title, the corner labels a
    // title and no position.
    expect(plot.querySelectorAll("span[title][style]")).toHaveLength(4)
    expect(within(plot).getByTitle(/never posted/)).toBeTruthy()
  })

  it("counts the corner that means something has stopped", () => {
    render(<SourcesOverview overview={OVERVIEW} />)

    // "Security": 18 posts in the window but silent for 20 days — the case a
    // list sorted by last post cannot tell apart from a rare publisher.
    const stalled = screen.getByTitle("used to publish often, then stopped")
    expect(stalled.textContent).toBe("Went quiet1")
  })
})
