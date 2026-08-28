// @vitest-environment jsdom
import * as React from "react"
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { ActivityGroup, ActivityToolLine } from "../activity-group"
import { groupSparkParts } from "../thread"
import type { PartState } from "@assistant-ui/react"
import { sparkToolkit } from "@/components/ai/tools/toolkit"

/**
 * The grouping function decides what the reader sees at all, so it gets tests
 * rather than a look.
 *
 * It has two opposite failure modes and both are quiet. Send an answer to the
 * rail and the card the user asked for is folded away behind a "worked for 8s"
 * line, so the conversation appears to have answered from nowhere. Send a lookup
 * to the transcript and the reply is buried under tables of the model's working
 * — which is the state this list was drawn up to fix.
 */

afterEach(cleanup)

const part = (p: Record<string, unknown>) => p as unknown as PartState

const IN_RAIL: ReadonlyArray<string> = ["group-activity"]
const IN_TRANSCRIPT: ReadonlyArray<string> = []

/** Tools whose card is the answer, and so must reach the transcript. */
const ANSWERS = [
  "find_feeds",
  "verify_feed",
  "add_feed",
  "chart_workspace",
  "create_artifact",
]

describe("what goes on the rail", () => {
  it("puts thinking on the rail", () => {
    expect(groupSparkParts(part({ type: "reasoning" }))).toEqual(IN_RAIL)
  })

  it("puts the answer in the transcript, which closes the rail", () => {
    expect(groupSparkParts(part({ type: "text" }))).toEqual(IN_TRANSCRIPT)
  })

  it("keeps a card that is the answer out of the rail", () => {
    // If this fails, the feed the user was about to subscribe to and the
    // document beside the chat are both invisible.
    for (const toolName of ANSWERS) {
      expect(
        groupSparkParts(
          part({ type: "tool-call", toolName, status: { type: "complete" } })
        ),
        `${toolName} should render in the transcript`
      ).toEqual(IN_TRANSCRIPT)
    }
  })

  it("puts a lookup on the rail even though it has a card", () => {
    // The complaint this fixed: a turn that answered "11 feeds, none failing"
    // printed the whole feed table and the whole article list above the answer,
    // and a turn that wrote a digest stacked ten article cards on top of it.
    const lookups = [
      "get_workspace_info",
      "list_folders",
      "list_feeds",
      "search_articles",
      "web_search",
      "get_article",
      "read_url",
    ]

    for (const toolName of lookups) {
      expect(
        groupSparkParts(
          part({ type: "tool-call", toolName, status: { type: "complete" } })
        ),
        `${toolName} should render on the rail`
      ).toEqual(IN_RAIL)
    }
  })

  it("puts a tool with no card on the rail", () => {
    expect(
      groupSparkParts(
        part({
          type: "tool-call",
          toolName: "mark_read",
          status: { type: "complete" },
        })
      )
    ).toEqual(IN_RAIL)
  })

  it("has a renderer for every tool it routes to the transcript", () => {
    // The two lists are maintained apart — one in thread.tsx, one in the
    // toolkit — and a transcript tool with no renderer falls through to the raw
    // ToolFallback, which is the JSON dump all of this exists to avoid.
    for (const toolName of ANSWERS) {
      expect(Object.keys(sparkToolkit), toolName).toContain(toolName)
    }
  })
})

describe("what the rail must never swallow", () => {
  it("shows a tool waiting for approval, card or not", () => {
    // Buried in a collapsed group, an approval prompt is a conversation that
    // has silently stopped and a user who thinks the app hung.
    expect(
      groupSparkParts(
        part({
          type: "tool-call",
          toolName: "add_feed",
          status: { type: "requires-action" },
        })
      )
    ).toEqual(IN_TRANSCRIPT)
  })

  it("shows a tool that failed", () => {
    expect(
      groupSparkParts(
        part({
          type: "tool-call",
          toolName: "mark_read",
          status: { type: "incomplete" },
        })
      )
    ).toEqual(IN_TRANSCRIPT)
  })
})

describe("the group itself", () => {
  it("is open while the model works and closed once it has answered", () => {
    const { rerender } = render(
      <ActivityGroup running steps={2}>
        <p>a thought</p>
      </ActivityGroup>
    )
    expect(screen.getByText("a thought")).toBeTruthy()
    expect(screen.getByRole("button").textContent).toContain("Working")

    rerender(
      <ActivityGroup running={false} steps={2}>
        <p>a thought</p>
      </ActivityGroup>
    )
    expect(screen.queryByText("a thought")).toBeNull()
    expect(screen.getByRole("button").textContent).toContain("2 steps")
  })

  it("stays open once the reader opens it", () => {
    // Without this the group a reader deliberately expanded slams shut the
    // instant the run finishes, which reads as the app fighting them.
    const { rerender } = render(
      <ActivityGroup running={false} steps={1}>
        <p>a thought</p>
      </ActivityGroup>
    )
    fireEvent.click(screen.getByRole("button"))
    expect(screen.getByText("a thought")).toBeTruthy()

    rerender(
      <ActivityGroup running={false} steps={3}>
        <p>a thought</p>
      </ActivityGroup>
    )
    expect(screen.getByText("a thought")).toBeTruthy()
  })
})

describe("a tool line", () => {
  const line = (args: unknown, toolName = "find_feeds", result?: unknown) => {
    const props = {
      toolName,
      args,
      result,
      status: { type: "complete" },
    } as unknown as React.ComponentProps<typeof ActivityToolLine>
    return render(<ActivityToolLine {...props} />).container.textContent
  }

  it("names the tool in words and shows the argument that identifies the call", () => {
    expect(line({ topic: "healthcare AI" })).toContain("Find feeds")
    expect(line({ topic: "healthcare AI" })).toContain("healthcare AI")
  })

  it("falls back to any short string, so a new tool still says something", () => {
    expect(line({ something_new: "a value" })).toContain("a value")
  })

  it("shows nothing rather than a dump when no argument is worth printing", () => {
    expect(line({ limit: 20, unread_only: true })).toBe("Find feeds")
  })

  it("truncates an argument long enough to wrap the line", () => {
    const text = line({ url: `https://example.com/${"x".repeat(200)}` })
    expect(text?.length).toBeLessThan(80)
    expect(text).toContain("…")
  })

  it("names the article it read rather than the id it was given", () => {
    // Reading is on the rail now, so a digest turn is ten of these lines. Ten
    // rows of `Read · art_9f2c…` would be a worse account of the work than no
    // rail at all.
    const text = line(
      { id: "art_9f2ce41b8a" },
      "get_article",
      { id: "art_9f2ce41b8a", title: "Model routing with Google Cloud API Gateway" }
    )
    expect(text).toContain("Read")
    expect(text).toContain("Model routing with Google Cloud API Gateway")
    expect(text).not.toContain("art_9f2ce41b8a")
  })

  it("says nothing rather than an id while a read is still in flight", () => {
    expect(line({ id: "art_9f2ce41b8a" }, "get_article")).toBe("Read")
  })

  it("calls a step what a person would call it", () => {
    expect(line({}, "get_workspace_info")).toBe("Checked the workspace")
    expect(line({}, "search_articles")).toContain("Searched articles")
  })

  it("holds a lookup's card folded away, and opens it on request", () => {
    // The other half of moving lookups onto the rail. Folding a feed table out
    // of the transcript is only acceptable because checking it is one click; if
    // the card stopped being reachable, the rail would be hiding rather than
    // tidying.
    const props = {
      toolName: "list_feeds",
      args: {},
      status: { type: "complete" },
    } as unknown as React.ComponentProps<typeof ActivityToolLine>

    render(
      <ActivityToolLine {...props}>
        <p>the feed table</p>
      </ActivityToolLine>
    )

    expect(screen.queryByText("the feed table")).toBeNull()
    fireEvent.click(screen.getByRole("button"))
    expect(screen.getByText("the feed table")).toBeTruthy()
  })
})
