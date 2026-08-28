import registry from "./ai-models.json"

// The catalogue in ai-models.json does double duty: it renders the model picker on the
// client, and it is the allowlist the server validates against. Nothing here reads
// process.env — provider availability is a server-only concern and lives in
// src/server/ai/env.ts, so this module stays safe to import from client code.

export type EffortId = "none" | "minimal" | "low" | "medium" | "high" | "xhigh"

export type ProviderId = "openai" | "vercel-gateway" | "openrouter"

export interface AIEffort {
  id: EffortId
  label: string
  hint: string
}

export interface AIProvider {
  id: ProviderId
  label: string
  envKey: string
  priority: number
}

export interface AIModel {
  id: string
  label: string
  group: string
  description: string
  contextWindow: number
  /** Empty when the model has no reasoning-effort control. */
  efforts: Array<EffortId>
  defaultEffort: EffortId | null
  /** Provider id -> the model id that provider uses. Providers differ; see the JSON note. */
  servedBy: Partial<Record<ProviderId, string>>
}

interface AIRegistry {
  version: string
  defaultModelId: string
  efforts: Array<AIEffort>
  providers: Array<AIProvider>
  models: Array<AIModel>
}

const catalogue = registry as unknown as AIRegistry

export const EFFORTS: Array<AIEffort> = catalogue.efforts
export const EFFORT_IDS = catalogue.efforts.map((e) => e.id) as [
  EffortId,
  ...Array<EffortId>,
]
export const MODELS: Array<AIModel> = catalogue.models
/** Providers in resolution order: OpenAI, then the Vercel gateway, then OpenRouter. */
export const PROVIDERS: Array<AIProvider> = [...catalogue.providers].sort(
  (a, b) => a.priority - b.priority
)
export const DEFAULT_MODEL_ID = catalogue.defaultModelId

export function getModel(id: string | undefined): AIModel | undefined {
  if (!id) return undefined
  return MODELS.find((m) => m.id === id)
}

export function getEffort(id: EffortId): AIEffort | undefined {
  return EFFORTS.find((e) => e.id === id)
}

/**
 * Resolves a possibly-untrusted (modelId, effort) pair to a valid one.
 *
 * An unknown model falls back to the catalogue default; an effort the chosen model
 * does not support falls back to that model's default. Callers therefore never have
 * to trust what arrived over the wire — see src/routes/api/chat.ts.
 */
export function resolveModelChoice(
  modelId: string | undefined,
  effort: EffortId | undefined
): { model: AIModel; effort: EffortId | null } {
  const model = getModel(modelId) ?? getModel(DEFAULT_MODEL_ID) ?? MODELS[0]
  if (!model) {
    throw new Error("[ai] ai-models.json contains no models.")
  }
  return { model, effort: resolveEffortFor(model, effort) }
}

/** The effort to actually use for a model, given a requested one. Null means "don't send it". */
export function resolveEffortFor(
  model: AIModel,
  effort: EffortId | undefined
): EffortId | null {
  if (model.efforts.length === 0) return null
  if (effort && model.efforts.includes(effort)) return effort
  return model.defaultEffort ?? model.efforts[0] ?? null
}

/** Models grouped by vendor, preserving catalogue order — used to render the picker. */
export function getModelsGrouped(): Array<{
  group: string
  models: Array<AIModel>
}> {
  const groups: Array<{ group: string; models: Array<AIModel> }> = []
  for (const model of MODELS) {
    const existing = groups.find((g) => g.group === model.group)
    if (existing) existing.models.push(model)
    else groups.push({ group: model.group, models: [model] })
  }
  return groups
}

/** The efforts a given model offers, as full objects, in catalogue order. */
export function getEffortsFor(model: AIModel): Array<AIEffort> {
  return EFFORTS.filter((e) => model.efforts.includes(e.id))
}

/** Short label for the composer pill, e.g. "GPT-5.6 Luna · Low". */
export function formatModelChoice(
  model: AIModel,
  effort: EffortId | null
): string {
  const effortLabel = effort ? getEffort(effort)?.label : undefined
  return effortLabel ? `${model.label} · ${effortLabel}` : model.label
}
