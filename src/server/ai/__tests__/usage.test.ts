import { describe, expect, it } from "vitest"
import { AiUsageCollector, creditsForCost } from "../usage"

const usage = {
  inputTokens: 100,
  inputTokenDetails: {
    noCacheTokens: 70,
    cacheReadTokens: 20,
    cacheWriteTokens: 10,
  },
  outputTokens: 40,
  outputTokenDetails: { textTokens: 30, reasoningTokens: 10 },
  totalTokens: 140,
}

describe("Spark AI usage metering", () => {
  it("converts provider cost to microcredits without whole-credit rounding", () => {
    expect(creditsForCost(0.0002)).toBe(0.02)
    expect(creditsForCost(0.000333333)).toBe(0.033334)
    expect(creditsForCost(0)).toBe(0)
  })

  it("sums every Gateway call, including web search", async () => {
    const collector = new AiUsageCollector()
    collector.startLanguageModelCall({
      callId: "call-1",
      provider: "vercel-gateway",
      modelId: "openai/gpt-5-mini",
    })
    collector.finishLanguageModelCall({
      callId: "call-1",
      provider: "vercel-gateway",
      modelId: "openai/gpt-5-mini",
      responseId: "response-1",
      finishReason: "tool-calls",
      usage,
      providerMetadata: {
        gateway: { cost: "0.004", generationId: "gen_chat" },
      },
    })
    collector.recordWebSearch({
      provider: "vercel-gateway",
      modelId: "perplexity/sonar",
      response: { id: "response-2", modelId: "perplexity/sonar" },
      finishReason: "stop",
      usage,
      providerMetadata: {
        gateway: { cost: 0.0015, generationId: "gen_search" },
      },
    })

    const summary = await collector.summarize("completed")
    expect(summary.costUsd).toBe(0.0055)
    expect(summary.chargedCredits).toBe(0.55)
    expect(summary.steps).toHaveLength(2)
    expect(summary.steps.map((step) => step.kind)).toEqual([
      "chat",
      "web_search",
    ])
    expect(summary.inputTokens).toBe(200)
    expect(summary.reasoningTokens).toBe(20)
    expect(summary.unpricedSteps).toBe(0)
  })

  it("charges known completed calls and flags an interrupted unpriced call", async () => {
    const collector = new AiUsageCollector()
    collector.startLanguageModelCall({
      callId: "priced",
      provider: "vercel-gateway",
      modelId: "openai/gpt-5-mini",
    })
    collector.finishLanguageModelCall({
      callId: "priced",
      provider: "vercel-gateway",
      modelId: "openai/gpt-5-mini",
      responseId: "response-1",
      finishReason: "tool-calls",
      usage,
      providerMetadata: { gateway: { cost: 0.002 } },
    })
    collector.startLanguageModelCall({
      callId: "interrupted",
      provider: "vercel-gateway",
      modelId: "openai/gpt-5-mini",
    })

    const summary = await collector.summarize("incomplete")
    expect(summary.chargedCredits).toBe(0.2)
    expect(summary.unpricedSteps).toBe(1)
  })
})
