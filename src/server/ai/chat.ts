import { convertToModelMessages, stepCountIs, streamText } from "ai"
import { resolveModelSelection } from "./models"
import { buildSystemPrompt } from "./prompt"
import { allowedToolNames, buildChatTools } from "./tools"
import type { UIMessage } from "ai"
import type { EffortId } from "@/config/ai-models"
import type { AutonomyId } from "@/config/autonomy"
import type { ApiPrincipal } from "../api/principal"

export interface ChatRequest {
  messages: Array<UIMessage>
  modelId?: string | undefined
  effort?: EffortId | undefined
  autonomy: AutonomyId
  skillId?: string | undefined
}

export interface ChatBillingCallbacks {
  onComplete: (costUsd: number | null) => Promise<void>
  onIncomplete: () => Promise<void>
}

function gatewayCost(event: {
  finalStep: { providerMetadata?: Record<string, Record<string, unknown>> }
}): number | null {
  const raw = event.finalStep.providerMetadata?.gateway?.cost
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) return raw
  if (typeof raw === "string") {
    const parsed = Number(raw)
    if (Number.isFinite(parsed) && parsed >= 0) return parsed
  }
  return null
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

  return streamText({
    model: selection.model,
    system: buildSystemPrompt(principal, request.autonomy, request.skillId),
    // v7: async, and returns the full history rather than a single turn.
    messages: await convertToModelMessages(request.messages),
    tools: buildChatTools(principal, request.autonomy),
    stopWhen: stepCountIs(8),
    // Provider-agnostic reasoning control — the SDK maps this onto each
    // provider's native parameter, so there is no per-vendor branching here.
    // Omitted entirely for models with no effort control.
    ...(selection.effort ? { reasoning: selection.effort } : {}),
    onEnd: billing
      ? async (event) => billing.onComplete(gatewayCost(event))
      : undefined,
    onAbort: billing ? async () => billing.onIncomplete() : undefined,
    onError: async ({ error }) => {
      console.error(
        `[ai] stream error (${selection.providerId}/${selection.upstreamModelId}, tools: ${allowedToolNames(
          principal,
          request.autonomy
        ).join(", ")}):`,
        error
      )
      await billing?.onIncomplete()
    },
  })
}
