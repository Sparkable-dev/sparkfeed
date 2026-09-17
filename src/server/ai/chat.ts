import { convertToModelMessages, stepCountIs, streamText } from "ai"
import { resolveModelSelection } from "./models"
import { buildSystemPrompt } from "./prompt"
import { allowedToolNames, buildChatTools } from "./tools"
import { AiUsageCollector } from "./usage"
import type { UIMessage } from "ai"
import type { EffortId } from "@/config/ai-models"
import type { AutonomyId } from "@/config/autonomy"
import type { ApiPrincipal } from "../api/principal"
import type { AiUsageRequestStatus, AiUsageSummary } from "./usage"

export interface ChatRequest {
  messages: Array<UIMessage>
  modelId?: string | undefined
  effort?: EffortId | undefined
  autonomy: AutonomyId
  skillId?: string | undefined
}

export interface ChatBillingCallbacks {
  onComplete: (usage: AiUsageSummary) => Promise<void>
  onIncomplete: (usage: AiUsageSummary) => Promise<void>
}

/**
 * The single `streamText` call site.
 *
 * Two lines here do most of the work.
 *
 * `convertToModelMessages(request.messages)` sends the whole conversation. The
 * route this replaced hand-extracted only the last user message and sent
 * `[system, user]`, so the model had no memory between turns and answered every
 * follow-up blind. That, more than the model choice, is what made the old page
 * feel like it was making things up.
 *
 * `stopWhen: stepCountIs(...)` is not optional once tools exist. Without it the
 * run ends the moment the model emits a tool call, so it never sees its own
 * results and the user gets an empty turn. Eight steps is room for a real chain
 * — list folders, search, read an article, then answer — while still bounding a
 * model that decides to loop.
 */
export async function buildChatStream(
  principal: ApiPrincipal,
  request: ChatRequest,
  billing?: ChatBillingCallbacks
) {
  const selection = resolveModelSelection(request.modelId, request.effort)
  const usage = new AiUsageCollector()
  let settlement: Promise<void> | null = null
  const finalize = (status: AiUsageRequestStatus) => {
    if (settlement) return settlement
    const callback =
      status === "completed" ? billing?.onComplete : billing?.onIncomplete
    settlement = callback
      ? usage.summarize(status).then(callback)
      : Promise.resolve()
    return settlement
  }

  return streamText({
    model: selection.model,
    system: buildSystemPrompt(principal, request.autonomy, request.skillId),
    // v7: async, and returns the full history rather than a single turn.
    messages: await convertToModelMessages(request.messages),
    tools: buildChatTools(principal, request.autonomy, usage),
    stopWhen: stepCountIs(8),
    maxOutputTokens: 4096,
    // Provider-agnostic reasoning control — the SDK maps this onto each
    // provider's native parameter, so there is no per-vendor branching here.
    // Omitted entirely for models with no effort control.
    ...(selection.effort ? { reasoning: selection.effort } : {}),
    onLanguageModelCallStart: (event) => usage.startLanguageModelCall(event),
    onChunk: ({ chunk }) => {
      if ("providerMetadata" in chunk) usage.captureChunk(chunk)
    },
    onLanguageModelCallEnd: (event) => usage.finishLanguageModelCall(event),
    onEnd: billing ? async () => finalize("completed") : undefined,
    onAbort: billing ? async () => finalize("incomplete") : undefined,
    onError: async ({ error }) => {
      console.error(
        `[ai] stream error (${selection.providerId}/${selection.upstreamModelId}, tools: ${allowedToolNames(
          principal,
          request.autonomy
        ).join(", ")}):`,
        error
      )
      if (billing) await finalize("error")
    },
  })
}
