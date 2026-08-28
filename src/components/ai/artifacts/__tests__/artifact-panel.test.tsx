// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { ArtifactCard } from "../ArtifactCard"
import { ArtifactPanel } from "../ArtifactPanel"
import { ArtifactProvider } from "../artifact-context"
import type { ArtifactArgs } from "@/server/ai/artifacts"

/**
 * The panel cannot be checked against a live model — the chat needs a provider
 * key and demo deployments refuse to reach one at all — so it is checked here
 * instead, driven by the same props assistant-ui hands the renderer.
 *
 * These are the behaviours that would otherwise only be caught by a person
 * noticing: whether a markdown document actually renders as markdown, whether
 * the toggle shows the source, and whether the iframe's sandbox is still
 * missing `allow-same-origin`.
 */

afterEach(cleanup)

function mount(args: Partial<ArtifactArgs>, streaming = false) {
  return render(
    <ArtifactProvider>
      <ArtifactCard
        args={args}
        toolCallId="call_1"
        status={{ type: streaming ? "running" : "complete" }}
      />
      <ArtifactPanel />
    </ArtifactProvider>
  )
}

const markdown: Partial<ArtifactArgs> = {
  title: "This week in AI",
  kind: "markdown",
  content: "# Three things\n\n- one\n- two\n\n**bold**",
}

const html: Partial<ArtifactArgs> = {
  title: "Unread by folder",
  kind: "html",
  content: "<!doctype html><html><body><h1>Chart</h1></body></html>",
}

describe("the card", () => {
  it("shows nothing but the panel until it is clicked", () => {
    mount(markdown)
    expect(screen.queryByRole("complementary")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: /open this week in ai/i }))
    expect(screen.getByLabelText("Document: This week in AI")).toBeTruthy()
  })

  it("counts words for prose and lines for a page", () => {
    mount(markdown)
    expect(screen.getByRole("button").textContent).toContain("words")

    cleanup()
    mount(html)
    expect(screen.getByRole("button").textContent).toContain("line")
  })
})

describe("markdown documents", () => {
  it("previews as rendered markdown, not as text", () => {
    mount(markdown)
    fireEvent.click(screen.getByRole("button", { name: /open/i }))

    // A heading element, not a line beginning with "#".
    expect(screen.getByRole("heading", { name: "Three things" })).toBeTruthy()
    expect(screen.getAllByRole("listitem")).toHaveLength(2)
  })

  it("shows the source behind the toggle", () => {
    const { container } = mount(markdown)
    fireEvent.click(screen.getByRole("button", { name: /open/i }))
    fireEvent.click(screen.getByRole("button", { name: "Markdown" }))

    expect(container.querySelector("pre")?.textContent).toBe(markdown.content)
    expect(screen.queryByRole("heading", { name: "Three things" })).toBeNull()
  })
})

describe("html documents", () => {
  it("previews in a frame that cannot reach the app", () => {
    const { container } = mount(html)
    fireEvent.click(screen.getByRole("button", { name: /open/i }))

    const frame = container.querySelector("iframe")
    expect(frame?.getAttribute("srcdoc")).toBe(html.content)

    /*
      The one line in the panel where a mistake is a security bug rather than a
      visual one. `allow-scripts` with `allow-same-origin` would give
      model-written HTML the user's session.
    */
    const sandbox = frame?.getAttribute("sandbox") ?? ""
    expect(sandbox).toContain("allow-scripts")
    expect(sandbox).not.toContain("allow-same-origin")
  })

  it("holds the preview back while the page is still being written", () => {
    const { container } = mount(html, true)
    fireEvent.click(screen.getByRole("button", { name: /open/i }))

    // A half-written document reloads the frame on every chunk and flashes
    // through broken states, so the source is shown until it is finished.
    expect(container.querySelector("iframe")).toBeNull()
    expect(container.querySelector("pre")?.textContent).toBe(html.content)
    expect(
      screen.getByRole("button", { name: "Preview" }).hasAttribute("disabled")
    ).toBe(true)
  })
})
