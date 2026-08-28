import { createGateway } from "@ai-sdk/gateway"
import { createOpenAI } from "@ai-sdk/openai"
import { configuredProviders, defaultModelOverride } from "./env"
import { AI_NO_PROVIDER } from "./errors"
import type { LanguageModel } from "ai"
import type { AIModel, EffortId, ProviderId } from "@/config/ai-models"
import {
  DEFAULT_MODEL_ID,
  PROVIDERS,
  getModel,
  resolveModelChoice,
} from "@/config/ai-models"

export interface ModelSelection {
  model: LanguageModel
  /** The provider that ended up serving the request. */
  providerId: ProviderId
  /** The provider-specific model id actually sent upstream. */
  upstreamModelId: string
  /** Catalogue entry the caller asked for, after allowlist validation. */
  catalogueModel: AIModel
  /** Null when the model has no reasoning-effort control. */
  effort: EffortId | null
}

/**
 * Picks the provider for a model: highest priority (OpenAI, then the Vercel
 * gateway, then OpenRouter) that both has credentials and actually serves it.
 *
 * The `servedBy` check matters as much as the credentials check — Claude and
 * Gemini have no entry under `openai`, so an OPENAI_API_KEY alone must not make
 * them look reachable.
 */
function pickProvider(
  model: AIModel
): { providerId: ProviderId; upstreamModelId: string } | null {
  const available = configuredProviders()
  for (const provider of PROVIDERS) {
    const upstreamModelId = model.servedBy[provider.id]
    if (upstreamModelId && available[provider.id]) {
      return { providerId: provider.id, upstreamModelId }
    }
  }
  return null
}

function instantiate(
  providerId: ProviderId,
  upstreamModelId: string
): LanguageModel {
  switch (providerId) {
    case "openai":
      // Default call path is the Responses API, which is what OpenAI-direct wants.
      return createOpenAI({ apiKey: process.env.OPENAI_API_KEY })(
        upstreamModelId
      )

    case "vercel-gateway":
      return createGateway({ apiKey: process.env.AI_GATEWAY_API_KEY })(
        upstreamModelId
      )

    case "openrouter":
      // OpenRouter speaks Chat Completions, not the Responses API, so this must
      // be `.chat(...)` — the bare call would post to /responses and 404.
      return createOpenAI({
        apiKey: process.env.OPENROUTER_API_KEY,
        baseURL: "https://openrouter.ai/api/v1",
      }).chat(upstreamModelId)
  }
}

/**
 * Validates an untrusted (modelId, effort) pair against the catalogue and binds
 * it to a live provider.
 *
 * Called before the stream opens so a misconfiguration surfaces as a real 503
 * with a readable body, rather than as a stream that dies silently.
 */
export function resolveModelSelection(
  requestedModelId: string | undefined,
  requestedEffort: EffortId | undefined
): ModelSelection {
  const { model: catalogueModel, effort } = resolveModelChoice(
    requestedModelId ?? serverDefaultModelId(),
    requestedEffort
  )

  const picked = pickProvider(catalogueModel)
  if (picked) {
    return {
      model: instantiate(picked.providerId, picked.upstreamModelId),
      providerId: picked.providerId,
      upstreamModelId: picked.upstreamModelId,
      catalogueModel,
      effort,
    }
  }

  // The requested model is unreachable. Fall back to the catalogue default
  // before giving up, so one unconfigured vendor does not break the whole page.
  const fallback = getModel(DEFAULT_MODEL_ID)
  if (fallback && fallback.id !== catalogueModel.id) {
    const fallbackProvider = pickProvider(fallback)
    if (fallbackProvider) {
      console.warn(
        `[ai] ${catalogueModel.id} has no configured provider; falling back to ${fallback.id}.`
      )
      return {
        model: instantiate(
          fallbackProvider.providerId,
          fallbackProvider.upstreamModelId
        ),
        providerId: fallbackProvider.providerId,
        upstreamModelId: fallbackProvider.upstreamModelId,
        catalogueModel: fallback,
        effort: resolveModelChoice(fallback.id, requestedEffort).effort,
      }
    }
  }

  throw AI_NO_PROVIDER(catalogueModel.label)
}

/** `AI_DEFAULT_MODEL`, but only if it names a real catalogue entry. */
function serverDefaultModelId(): string {
  const override = defaultModelOverride()
  if (!override) return DEFAULT_MODEL_ID
  if (getModel(override)) return override
  console.warn(
    `[ai] AI_DEFAULT_MODEL="${override}" is not in ai-models.json; using ${DEFAULT_MODEL_ID}.`
  )
  return DEFAULT_MODEL_ID
}
