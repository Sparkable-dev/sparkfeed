// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { ArtifactPanel } from "../ArtifactPanel"
import { AssetsDock } from "../AssetsDock"
import { ArtifactProvider, useArtifactPanel } from "../artifact-context"
import type { ReportBlock } from "../artifact-context"

/**
 * A report you can lose is not a report.
 *
 * Two things shipped broken and both are invisible from the code alone. Filing a
 * chart opened the panel, and closing that panel was the end of it — nothing
 * anywhere reopened one. And the blocks lived in React state, so a reload of the
 * conversation they were filed from threw them away.
 *
 * So these drive the whole loop the user drives: file something, close it, come
 * back to it through the dock, and come back to it again after the page has been
 * rebuilt from scratch.
 */

afterEach(cleanup)
beforeEach(() => window.localStorage.clear())

const block: ReportBlock = {
  id: "chart_1",
  kind: "chart",
  title: "Articles per day",
  summary: "166 articles in the last 30 days.",
  chart: {
    shape: "series",
    unit: "articles",
    total: "166",
    delta: "+72%",
    points: [
      { label: "Mon", value: 4 },
      { label: "Tue", value: 9 },
    ],
  },
}

/** Stands in for a chart card's "Add to report" button. */
function FileIt() {
  const panel = useArtifactPanel()
  return (
    <button type="button" onClick={() => panel?.addToReport(block)}>
      Add to report
    </button>
  )
}

function mount(threadId = "cht_test123456") {
  return render(
    <ArtifactProvider threadId={threadId}>
      <FileIt />
      <AssetsDock />
      <ArtifactPanel />
    </ArtifactProvider>
  )
}

/** The dock's trigger, which is also the only way back to a closed report. */
const dock = () => screen.queryByLabelText(/^Assets \(/)

describe("filing something into the report", () => {
  it("opens the report and offers a way back once it is closed", () => {
    mount()
    // Nothing made yet, so the dock is not there to be noticed.
    expect(dock()).toBeNull()

    fireEvent.click(screen.getByText("Add to report"))
    expect(screen.getByLabelText("Report")).toBeTruthy()
    expect(screen.getByText("Articles per day")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    expect(screen.queryByLabelText("Report")).toBeNull()

    // The door this test exists for.
    fireEvent.click(dock()!)
    fireEvent.click(screen.getByText("Report"))
    expect(screen.getByLabelText("Report")).toBeTruthy()
  })

  it("files the same block once, however many times it is clicked", () => {
    mount()
    fireEvent.click(screen.getByText("Add to report"))
    fireEvent.click(screen.getByText("Add to report"))
    // Reads off the panel, which is the list the export is built from.
    expect(screen.getAllByText("Articles per day")).toHaveLength(1)
  })
})

describe("coming back to a conversation", () => {
  it("still has the report after the page is rebuilt", () => {
    const first = mount()
    fireEvent.click(screen.getByText("Add to report"))
    first.unmount()

    mount()
    fireEvent.click(dock()!)
    fireEvent.click(screen.getByText("Report"))
    expect(screen.getByText("Articles per day")).toBeTruthy()
  })

  it("keeps one conversation's report out of another's", () => {
    const first = mount("cht_aaaaaaaaaaaa")
    fireEvent.click(screen.getByText("Add to report"))
    first.unmount()

    mount("cht_bbbbbbbbbbbb")
    expect(dock()).toBeNull()
  })

  it("survives a corrupted saved value rather than taking the page down", () => {
    window.localStorage.setItem("sparkfeed.report.cht_test123456", "{not json")
    expect(() => mount()).not.toThrow()
    expect(dock()).toBeNull()
  })
})
