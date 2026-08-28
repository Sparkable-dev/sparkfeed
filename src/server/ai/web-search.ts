import { createGateway } from "@ai-sdk/gateway"
import { generateText, tool } from "ai"
import { z } from "zod"
import type { AutonomyId } from "@/config/autonomy"

/**
 * Web search, as a second model rather than a search API.
 *
 * Perplexity's Sonar models answer a question *and* return the pages they used,
 * and they are reachable through the AI Gateway this app is already configured
 * for — so search needs no new vendor, no new account and no new key, and it
 * keeps working whichever model the user has picked in the composer pill.
 *
 * The cost of that choice is honest: this is a model call, not a search call.
 * It is slower than a search API, it costs per use, and the answer is generated
 * rather than retrieved. What we keep is the citations, which are retrieved —
 * they are what the cards render, and what `read_url` can then open in full.
 *
 * Chat-only, like `artifacts.ts`. `TOOL_REGISTRY` describes what a caller may
 * do *to a workspace*; a REST endpoint that proxies a search model belongs to
 * neither the REST API nor MCP.
 */

export const WEB_SEARCH_TOOL_NAME = "web_search"

/** Reading a search result is not a workspace write, so read-only may search. */
export const WEB_SEARCH_MIN_AUTONOMY: AutonomyId = "read-only"

/** The gateway's id for Sonar. Small and fast; the big one is not worth 4x here. */
const SEARCH_MODEL = "perplexity/sonar"

/** Bounded because every call is billable and the model decides when to call. */
const MAX_OUTPUT_TOKENS = 1200

export const WebSearchInput = z.object({
  query: z
    .string()
    .min(2)
    .max(400)
    .describe(
      "What to search for, phrased as a question or a topic. Be specific — this is a live web search, not a lookup in the user's feeds."
    ),
  recency: z
    .enum(["day", "week", "month", "year"])
    .optional()
    .describe(
      "Restrict to recent pages. Use 'week' for news, and leave unset for background or reference questions."
    ),
})

export type WebSearchArgs = z.infer<typeof WebSearchInput>

export interface WebSearchSource {
  title: string
  url: string
  domain: string
}

export interface WebSearchResult {
  query: string
  answer: string
  sources: Array<WebSearchSource>
}

const DESCRIPTION =
  "Search the live web and return an answer with the pages it came from. " +
  "Use this for anything outside the user's own feeds: current events, background on a company " +
  "or person, what other people are saying about a topic. " +
  "Do NOT use it to search the user's subscriptions — that is `search_articles`, which is free, " +
  "instant, and the only one that knows what they actually read. " +
  "The results render as cards the user can open, so cite what you used and do not paste the " +
  "URLs again in prose."

/**
 * Failure is *returned*, never thrown.
 *
 * A missing gateway key is a deployment fact, not a bug in the conversation. If
 * it threw, the whole stream would abort and the user would see "Spark AI could
 * not respond" for a question the model could still have answered from the
 * workspace. Returned, the model reads it, says search is unavailable, and
 * carries on with the tools that do work.
 */
export function webSearchTool() {
  return tool({
    description: DESCRIPTION,
    inputSchema: WebSearchInput,
    execute: async (args) => {
      const apiKey = process.env.AI_GATEWAY_API_KEY
      if (!apiKey) {
        return {
          error: {
            code: "not_configured",
            message:
              "Web search is not available on this deployment. Answer from the workspace instead, and say search is unavailable.",
          },
        }
      }

      try {
        const result = await generateText({
          model: createGateway({ apiKey })(SEARCH_MODEL),
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          system:
            "Answer the question from current web sources. Be concise and factual. " +
            "Do not speculate; if the sources disagree, say so.",
          prompt: buildPrompt(args),
        })

        return {
          query: args.query,
          answer: result.text.trim(),
          sources: extractSources(result),
        } satisfies WebSearchResult
      } catch (error) {
        console.error("[ai.web_search] failed:", error)
        return {
          error: {
            code: "upstream_failed",
            message:
              "That search did not come back. Try once more, or answer from the workspace.",
          },
        }
      }
    },
  })
}

function buildPrompt(args: WebSearchArgs): string {
  if (!args.recency) return args.query
  const window =
    args.recency === "day"
      ? "the last 24 hours"
      : `the last ${args.recency === "week" ? "week" : args.recency === "month" ? "month" : "year"}`
  return `${args.query}\n\nOnly use sources published within ${window}.`
}

/**
 * The citations, wherever the provider chose to put them.
 *
 * Sonar returns them as `sources` on the result in current AI SDK versions, and
 * has previously returned them under provider metadata as `citations`. Both are
 * read because a rename upstream should cost the citation list, not the search:
 * the answer is still worth showing without cards under it.
 */
function extractSources(result: {
  sources?: ReadonlyArray<unknown>
  providerMetadata?: Record<string, Record<string, unknown>> | undefined
}): Array<WebSearchSource> {
  const raw: Array<unknown> = [
    ...(result.sources ?? []),
    ...(asArray(result.providerMetadata?.perplexity?.citations) ?? []),
  ]

  const seen = new Set<string>()
  const sources: Array<WebSearchSource> = []

  for (const entry of raw) {
    const url =
      typeof entry === "string"
        ? entry
        : typeof (entry as { url?: unknown })?.url === "string"
          ? (entry as { url: string }).url
          : null
    if (!url || seen.has(url)) continue
    seen.add(url)

    const title =
      typeof (entry as { title?: unknown })?.title === "string"
        ? (entry as { title: string }).title
        : ""

    sources.push({ url, title: title || domainOf(url), domain: domainOf(url) })
  }

  return sources.slice(0, 10)
}

function asArray(value: unknown): Array<unknown> | null {
  return Array.isArray(value) ? value : null
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}
