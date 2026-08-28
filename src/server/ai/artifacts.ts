import { tool } from "ai"
import { z } from "zod"
import type { AutonomyId } from "@/config/autonomy"

/**
 * The artifact tool: a document the model writes into the side panel.
 *
 * This one lives here rather than in `src/server/tools/registry.ts`, and that is
 * deliberate. Every entry in the registry becomes three things — an MCP tool, a
 * REST endpoint and an operation in the OpenAPI document — because all of them
 * describe *the workspace*. An artifact describes nothing; it touches no table,
 * reads no feed, and means nothing to a client that has no side panel to put it
 * in. `POST /api/v1/artifacts` would be an endpoint that does nothing at all.
 *
 * So it is a chat-only tool, merged into the tool set in `tools.ts`. It is the
 * only tool in Spark AI whose entire effect is on the screen.
 */

export const ARTIFACT_KINDS = ["html", "markdown"] as const
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number]

export const ARTIFACT_TOOL_NAME = "create_artifact"

/**
 * Writing a document changes nothing in the workspace, so it is offered at
 * every autonomy level. Named here rather than assumed by the `+` menu, so the
 * menu's drift test has something to check it against.
 */
export const ARTIFACT_MIN_AUTONOMY: AutonomyId = "read-only"

export const ArtifactInput = z.object({
  title: z
    .string()
    .min(1)
    .max(120)
    .describe("A short title for the document, e.g. 'This week in AI'."),
  kind: z
    .enum(ARTIFACT_KINDS)
    .describe(
      "'html' for anything that should render as a page — layouts, charts, " +
        "interactive demos. Send a complete document starting with <!doctype html>, " +
        "with all CSS and JavaScript inline; it renders in a sandboxed frame with " +
        "no network access, so external stylesheets, fonts and scripts will not load. " +
        "'markdown' for prose — digests, reports, briefs, comparison tables. " +
        "GitHub-flavoured markdown, so tables and fenced code blocks work."
    ),
  content: z
    .string()
    .min(1)
    .describe(
      "The complete document. Not a fragment, and not wrapped in a code fence."
    ),
})

export type ArtifactArgs = z.infer<typeof ArtifactInput>

export interface ArtifactResult {
  kind: ArtifactKind
  title: string
  lines: number
  /** Read by the model, not the UI. See the note in `artifactTool`. */
  note: string
}

const DESCRIPTION =
  "Open a document in the side panel beside the conversation. Use this when the user asks for " +
  "something to look at or keep: a webpage, a mockup, a chart or visualisation, a reading digest, " +
  "a report, a comparison table, an OPML or config file. " +
  "Do not use it for ordinary replies, short answers, or a few lines of code — those belong in the " +
  "message itself, and a panel for two sentences is worse than no panel. " +
  "Write the whole document in one call; the panel shows exactly what you send and nothing fills in " +
  "around it. To revise a document, call this again with the full updated text."

/**
 * The result deliberately does **not** echo `content` back.
 *
 * A tool result re-enters the model's context on the next step, so returning
 * the document would bill every token of it twice and, on a long HTML page,
 * crowd out the conversation it was meant to serve. The client does not need it
 * either: the panel renders from the tool call's *arguments*, which stream in
 * as the model writes, so the document appears progressively rather than
 * arriving whole at the end.
 *
 * `note` is the other half of that. Left to itself a model narrates what it
 * just wrote, and the user reads the same digest twice — once in the panel and
 * once underneath it.
 */
export function artifactTool() {
  return tool({
    description: DESCRIPTION,
    inputSchema: ArtifactInput,
    execute: (args): ArtifactResult => ({
      kind: args.kind,
      title: args.title,
      lines: args.content.split(/\r?\n/).length,
      note:
        "The document is open in the user's side panel. Do not repeat its contents. " +
        "Reply with one line saying what it is, and stop.",
    }),
  })
}
