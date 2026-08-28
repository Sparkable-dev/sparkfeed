import { describe, expect, it } from "vitest"
import { toMarkdown } from "../ReportPanel"
import type { ReportBlock } from "../artifact-context"

/**
 * The report's export.
 *
 * This is the only part of the feature that leaves the app, so it is the part
 * worth pinning: whatever someone pastes into a brief has to still make sense
 * with no stylesheet, no SVG and no context around it.
 */

const chart: ReportBlock = {
  id: "chart_1",
  kind: "chart",
  title: "Unread by folder",
  summary: "412 unread, most of it in AI Research Labs.",
  chart: {
    shape: "bars",
    unit: "unread",
    total: "412",
    delta: null,
    points: [
      { label: "AI Research Labs", value: 291 },
      { label: "Cloud Platforms", value: 121 },
    ],
  },
}

describe("exporting a report", () => {
  it("keeps the numbers, not a picture of them", () => {
    /*
      A chart exports as its summary plus the table behind it. An inline SVG
      would not survive a paste into a doc, a ticket or a newsletter — and the
      numbers are the part a reader can actually check.
    */
    const markdown = toMarkdown([chart])

    expect(markdown).toContain("## Unread by folder")
    expect(markdown).toContain("412 unread, most of it in AI Research Labs.")
    expect(markdown).toContain("| AI Research Labs | 291 |")
    expect(markdown).toContain("| Cloud Platforms | 121 |")
    expect(markdown).not.toContain("<svg")
  })

  it("keeps the order blocks were filed in", () => {
    const second: ReportBlock = { ...chart, id: "chart_2", title: "Busiest feeds" }
    const markdown = toMarkdown([chart, second])
    expect(markdown.indexOf("Unread by folder")).toBeLessThan(
      markdown.indexOf("Busiest feeds")
    )
  })

  it("carries the delta when there is one", () => {
    const withDelta: ReportBlock = {
      ...chart,
      chart: { ...chart.chart!, delta: "+34%" },
    }
    expect(toMarkdown([withDelta])).toContain("**412** unread · +34%")
  })

  it("handles a note, which has no chart at all", () => {
    const note: ReportBlock = {
      id: "note_1",
      kind: "note",
      title: "Worth following up",
      summary: "Two of the healthcare feeds have not posted since June.",
    }
    const markdown = toMarkdown([note])
    expect(markdown).toContain("## Worth following up")
    expect(markdown).not.toContain("| --- |")
  })

  it("produces a document, not a fragment, when empty", () => {
    // The Copy button is disabled at zero blocks, but nothing should crash if
    // that ever stops being true.
    expect(toMarkdown([])).toBe("# Report\n")
  })
})
