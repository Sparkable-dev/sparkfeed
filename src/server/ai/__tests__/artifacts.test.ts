import { describe, expect, it } from "vitest"
import {
  ARTIFACT_TOOL_NAME,
  ArtifactInput,
  artifactTool,
} from "../artifacts"
import { TOOL_REGISTRY } from "../../tools/registry"

const page = {
  title: "Unread by folder",
  kind: "html" as const,
  content: "<!doctype html>\n<html>\n<body>hi</body>\n</html>",
}

describe("artifact input", () => {
  it("takes a titled document of a known kind", () => {
    expect(ArtifactInput.safeParse(page).success).toBe(true)
  })

  it("rejects a kind the panel cannot render", () => {
    // The panel has exactly two renderers. A third kind would reach the client
    // and fall through to markdown, quietly showing a PDF as text.
    expect(
      ArtifactInput.safeParse({ ...page, kind: "pdf" }).success
    ).toBe(false)
  })

  it("rejects an empty document", () => {
    expect(ArtifactInput.safeParse({ ...page, content: "" }).success).toBe(false)
  })
})

describe("artifact result", () => {
  const run = async () => {
    const execute = artifactTool().execute
    if (!execute) throw new Error("the artifact tool must be executable")
    // The executor ignores its options; the SDK's type for them carries a
    // generic `context` that only matters to tools which read it.
    const options = { toolCallId: "call_1", messages: [] } as never
    return await execute(page, options)
  }

  it("does not echo the document back to the model", async () => {
    /*
      The load-bearing assertion in this file. A tool result re-enters the
      context on the next step, so returning `content` would bill a long HTML
      page twice and crowd out the conversation. The client renders from the
      call's arguments instead — see `ArtifactCard`.
    */
    const result = await run()
    expect(JSON.stringify(result)).not.toContain("<!doctype html>")
    expect(result).not.toHaveProperty("content")
  })

  it("reports the size, so the model can describe it without re-reading it", async () => {
    const result = await run()
    expect(result).toMatchObject({ kind: "html", title: page.title, lines: 4 })
  })
})

describe("artifact tool placement", () => {
  it("stays out of the shared registry", () => {
    /*
      Everything in `TOOL_REGISTRY` becomes an MCP tool, a REST endpoint and an
      OpenAPI operation. An artifact is a thing on a screen: `POST
      /api/v1/artifacts` would accept a document and do nothing with it.
    */
    expect(TOOL_REGISTRY.map((t) => t.name)).not.toContain(ARTIFACT_TOOL_NAME)
  })
})
