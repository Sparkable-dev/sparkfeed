import { randomUUID } from "node:crypto"
import { createGateway } from "@ai-sdk/gateway"
import Decimal from "decimal.js"
import type { LanguageModelUsage, ProviderMetadata } from "ai"
import { SPARK_AI_CREDITS_PER_USD } from "@/server/entitlements/plan-policy"

export type AiUsageKind = "chat" | "web_search"
export type AiUsageRequestStatus =
  "completed" | "incomplete" | "error" | "stale"

export interface AiUsageStep {
  id: string
  sequence: number
  kind: AiUsageKind
  providerId: string
  modelId: string
  responseId: string | null
  generationId: string | null
  finishReason: string | null
  costUsd: number | null
  chargedCredits: number
  inputTokens: number
  cachedInputTokens: number
  cacheWriteTokens: number
  outputTokens: number
  reasoningTokens: number
  totalTokens: number
}

export interface AiUsageSummary {
  status: AiUsageRequestStatus
  providerId: string | null
  upstreamModelId: string | null
  costUsd: number
  chargedCredits: number
  unpricedSteps: number
  inputTokens: number
  cachedInputTokens: number
  cacheWriteTokens: number
  outputTokens: number
  reasoningTokens: number
  totalTokens: number
  steps: Array<AiUsageStep>
}

interface MutableStep extends Omit<AiUsageStep, "chargedCredits"> {
  callId: string
}

function finiteNumber(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function gatewayValue(
  metadata: ProviderMetadata | undefined,
  key: string
): unknown {
  return metadata?.gateway?.[key]
}

function tokens(usage?: LanguageModelUsage) {
  return {
    inputTokens: usage?.inputTokens ?? 0,
    cachedInputTokens: usage?.inputTokenDetails?.cacheReadTokens ?? 0,
    cacheWriteTokens: usage?.inputTokenDetails?.cacheWriteTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    reasoningTokens: usage?.outputTokenDetails?.reasoningTokens ?? 0,
    totalTokens: usage?.totalTokens ?? 0,
  }
}

/** Convert exact provider USD cost into credits, rounded up only at a microcredit. */
export function creditsForCost(costUsd: number): number {
  if (!Number.isFinite(costUsd) || costUsd < 0)
    throw new Error("AI cost must be a finite, non-negative number.")
  return new Decimal(costUsd)
    .mul(SPARK_AI_CREDITS_PER_USD)
    .toDecimalPlaces(6, Decimal.ROUND_CEIL)
    .toNumber()
}

/** Collects every model call in one turn, including the separate web-search model. */
export class AiUsageCollector {
  private readonly steps = new Map<string, MutableStep>()
  private activeCallId: string | null = null
  private sequence = 0

  startLanguageModelCall(event: {
    callId: string
    provider: string
    modelId: string
  }) {
    this.activeCallId = event.callId
    this.steps.set(event.callId, {
      id: randomUUID(),
      callId: event.callId,
      sequence: this.sequence++,
      kind: "chat",
      providerId: event.provider,
      modelId: event.modelId,
      responseId: null,
      generationId: null,
      finishReason: null,
      costUsd: null,
      ...tokens(),
    })
  }

  captureChunk(chunk: { providerMetadata?: ProviderMetadata }) {
    if (!this.activeCallId) return
    const step = this.steps.get(this.activeCallId)
    const generationId = gatewayValue(chunk.providerMetadata, "generationId")
    if (step && typeof generationId === "string") {
      step.generationId = generationId
    }
  }

  finishLanguageModelCall(event: {
    callId: string
    provider: string
    modelId: string
    responseId: string
    finishReason: string
    usage: LanguageModelUsage
    providerMetadata?: ProviderMetadata
  }) {
    const existing = this.steps.get(event.callId)
    const step: MutableStep = existing ?? {
      id: randomUUID(),
      callId: event.callId,
      sequence: this.sequence++,
      kind: "chat",
      providerId: event.provider,
      modelId: event.modelId,
      responseId: null,
      generationId: null,
      finishReason: null,
      costUsd: null,
      ...tokens(),
    }
    const generationId = gatewayValue(event.providerMetadata, "generationId")
    step.responseId = event.responseId
    step.finishReason = event.finishReason
    step.costUsd = finiteNumber(gatewayValue(event.providerMetadata, "cost"))
    step.generationId =
      typeof generationId === "string" ? generationId : step.generationId
    Object.assign(step, tokens(event.usage))
    this.steps.set(event.callId, step)
    if (this.activeCallId === event.callId) this.activeCallId = null
  }

  recordWebSearch(result: {
    provider?: string
    modelId?: string
    response?: { id?: string; modelId?: string }
    finishReason?: string
    usage?: LanguageModelUsage
    providerMetadata?: ProviderMetadata
  }) {
    const callId = randomUUID()
    const generationId = gatewayValue(result.providerMetadata, "generationId")
    this.steps.set(callId, {
      id: randomUUID(),
      callId,
      sequence: this.sequence++,
      kind: "web_search",
      providerId: result.provider ?? "vercel-gateway",
      modelId: result.response?.modelId ?? result.modelId ?? "perplexity/sonar",
      responseId: result.response?.id ?? null,
      generationId: typeof generationId === "string" ? generationId : null,
      finishReason: result.finishReason ?? null,
      costUsd: finiteNumber(gatewayValue(result.providerMetadata, "cost")),
      ...tokens(result.usage),
    })
  }

  async summarize(status: AiUsageRequestStatus): Promise<AiUsageSummary> {
    await this.reconcileMissingGatewayCosts()
    const ordered = [...this.steps.values()].sort(
      (left, right) => left.sequence - right.sequence
    )
    const priced = ordered.filter((step) => step.costUsd !== null)
    const cost = priced.reduce(
      (total, step) => total.plus(step.costUsd ?? 0),
      new Decimal(0)
    )
    const aggregate = ordered.reduce(
      (total, step) => ({
        inputTokens: total.inputTokens + step.inputTokens,
        cachedInputTokens: total.cachedInputTokens + step.cachedInputTokens,
        cacheWriteTokens: total.cacheWriteTokens + step.cacheWriteTokens,
        outputTokens: total.outputTokens + step.outputTokens,
        reasoningTokens: total.reasoningTokens + step.reasoningTokens,
        totalTokens: total.totalTokens + step.totalTokens,
      }),
      tokens()
    )
    const steps = ordered.map(({ callId: _callId, ...step }) => ({
      ...step,
      chargedCredits: step.costUsd === null ? 0 : creditsForCost(step.costUsd),
    }))
    const first = ordered[0]
    const costUsd = cost.toDecimalPlaces(10, Decimal.ROUND_HALF_UP).toNumber()
    return {
      status,
      providerId: first?.providerId ?? null,
      upstreamModelId: first?.modelId ?? null,
      costUsd,
      chargedCredits: creditsForCost(costUsd),
      unpricedSteps: ordered.length - priced.length,
      ...aggregate,
      steps,
    }
  }

  private async reconcileMissingGatewayCosts() {
    const unresolved = [...this.steps.values()].filter(
      (step) => step.costUsd === null && step.generationId
    )
    const apiKey = process.env.AI_GATEWAY_API_KEY
    if (!apiKey || unresolved.length === 0) return
    const gateway = createGateway({ apiKey })
    await Promise.all(
      unresolved.map(async (step) => {
        try {
          const generation = await gateway.getGenerationInfo({
            id: step.generationId!,
          })
          step.costUsd = generation.totalCost
          step.providerId = generation.providerName || step.providerId
          step.modelId = generation.model || step.modelId
          step.finishReason = generation.finishReason || step.finishReason
          step.inputTokens = generation.promptTokens
          step.cachedInputTokens = generation.cachedTokens
          step.cacheWriteTokens = generation.cacheCreationTokens
          step.outputTokens = generation.completionTokens
          step.reasoningTokens = generation.reasoningTokens
          step.totalTokens =
            generation.promptTokens + generation.completionTokens
        } catch (error) {
          console.error(
            `[ai.usage] could not reconcile ${step.generationId}:`,
            error
          )
        }
      })
    )
  }
}
