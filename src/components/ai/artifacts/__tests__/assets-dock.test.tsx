// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { ArtifactCard } from "../ArtifactCard"
import { ArtifactPanel } from "../ArtifactPanel"
import { AssetsDock } from "../AssetsDock"
import { ArtifactProvider } from "../artifact-context"
import type { ArtifactArgs } from "@/server/ai/artifacts"

/**
 * The one place everything a conversation made ends up.
 *
 * A document used to be reachable from exactly one spot in the scrollback — the
 * card that wrote it — so ten turns later the only route back to a briefing was
 * to scroll for it. These pin the two halves of the fix: that a card files
 * itself as it renders, and that opening a row from the dock shows the document
 * rather than an empty panel.
 */

afterEach(cleanup)

const digest: Partial<ArtifactArgs> = {
  title: "This week in AI",
  kind: "markdown",
  content: "# Three things\n\nthat happened",
}

const page: Partial<ArtifactArgs> = {
  title: "Reading dashboard",
  kind: "html",
  content: "<h1>Hello</h1>",
}

function mount(docs: Array<Partial<ArtifactArgs>>, streaming = false) {
  return render(
    <ArtifactProvider threadId="cht_dock12345678">
      {docs.map((args, index) => (
        <ArtifactCard
          key={index}
          args={args}
          toolCallId={`call_${index}`}
          status={{ type: streaming ? "running" : "complete" }}
        />
      ))}
      <AssetsDock />
      <ArtifactPanel />
    </ArtifactProvider>
  )
}

const dock = () => screen.queryByLabelText(/^Assets \(/)

describe("the dock", () => {
  it("stays out of the way until the chat has made something", () => {
    render(
      <ArtifactProvider threadId="cht_empty1234567">
        <AssetsDock />
      </ArtifactProvider>
    )
    expect(dock()).toBeNull()
  })

  it("counts everything the conversation produced", () => {
    mount([digest, page])
    expect(screen.getByLabelText("Assets (2)")).toBeTruthy()
  })

  it("lists documents in the order they were made", () => {
    mount([digest, page])
    fireEvent.click(dock()!)

    const rows = within(screen.getByLabelText("Assets list")).getAllByRole(
      "button"
    )
    expect(rows[0].textContent).toContain("This week in AI")
    expect(rows[1].textContent).toContain("Reading dashboard")
  })

  it("opens a document rather than an empty panel", () => {
    // The reason an asset carries its content instead of a pointer: opening by
    // id alone handed the panel nothing and waited for the owning card to
    // notice, which showed "Nothing to show yet" on the way in.
    mount([digest])
    fireEvent.click(dock()!)
    fireEvent.click(
      within(screen.getByLabelText("Assets list")).getByRole("button")
    )

    expect(screen.getByLabelText("Document: This week in AI")).toBeTruthy()
    expect(screen.getByText("that happened")).toBeTruthy()
    expect(screen.queryByText("Nothing to show yet.")).toBeNull()
  })

  it("says a document is still being written", () => {
    mount([digest], true)
    fireEvent.click(dock()!)
    expect(
      within(screen.getByLabelText("Assets list")).getByText("writing…")
    ).toBeTruthy()
  })
})
