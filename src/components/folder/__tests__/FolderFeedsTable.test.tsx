// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { FolderFeedsTable } from "../FolderFeedsTable"
import type { ManagedSource } from "@/server/rss"

afterEach(cleanup)

const SOURCES: Array<ManagedSource> = [
  {
    id: "source-1",
    name: "Alpha Engineering",
    url: "https://alpha.example.test/feed.xml",
    type: "rss",
    articleCount: 12,
    createdAt: "2026-08-20T00:00:00.000Z",
    lastFetchedAt: "2026-08-20T00:00:00.000Z",
    lastError: null,
    lastErrorAt: null,
  },
  {
    id: "source-2",
    name: "Bravo Product",
    url: "https://bravo.example.test",
    type: "scraped",
    articleCount: 3,
    createdAt: "2026-08-20T00:00:00.000Z",
    lastFetchedAt: null,
    lastError: null,
    lastErrorAt: null,
  },
]

describe("FolderFeedsTable", () => {
  it("keeps source filtering working after the Table v9 migration", async () => {
    const user = userEvent.setup()

    render(
      <FolderFeedsTable
        sources={SOURCES}
        onEdit={() => undefined}
        onDelete={() => undefined}
      />,
    )

    expect(screen.getByText("Alpha Engineering")).toBeTruthy()
    expect(screen.getByText("Bravo Product")).toBeTruthy()

    await user.type(screen.getByPlaceholderText("Filter sources…"), "bravo")

    expect(screen.queryByText("Alpha Engineering")).toBeNull()
    expect(screen.getByText("Bravo Product")).toBeTruthy()
  })
})
