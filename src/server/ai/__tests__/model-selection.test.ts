import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { resolveModelSelection } from "../models"
import {
  DEFAULT_MODEL_ID,
  EFFORT_IDS,
  MODELS,
  getModel,
  resolveEffortFor,
  resolveModelChoice,
} from "@/config/ai-models"

/**
 * The catalogue is the server-side allowlist, so these are security tests as
 * much as behaviour tests. `/api/chat` accepts `modelId` and `effort` straight
 * from the browser; the only thing standing between an arbitrary string and a
 * provider call is the resolution below.
 */

const KEYS = [
  "OPENAI_API_KEY",
  "AI_GATEWAY_API_KEY",
  "OPENROUTER_API_KEY",
] as const

let saved: Record<string, string | undefined> = {}

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
  for (const k of KEYS) delete process.env[k]
})

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe("catalogue validation", () => {
  it("falls back to the default model when the id is unknown", () => {
    const { model } = resolveModelChoice("../../etc/passwd", undefined)
    expect(model.id).toBe(DEFAULT_MODEL_ID)
  })

  it("rejects an effort the chosen model does not offer", () => {
    // DeepSeek V4 Flash only reasons at high and above; "none" must not survive.
    const deepseek = getModel("deepseek-v4-flash")
    expect(deepseek).toBeDefined()
    expect(resolveEffortFor(deepseek!, "none")).toBe("high")
  })

  it("keeps an effort the model does offer", () => {
    const gemini = getModel("gemini-3.5-flash")
    expect(resolveEffortFor(gemini!, "minimal")).toBe("minimal")
  })

  it("returns null for a model with no reasoning control", () => {
    const opus = getModel("claude-opus-5")
    expect(opus!.efforts).toHaveLength(0)
    expect(resolveEffortFor(opus!, "high")).toBeNull()
  })

  it("every catalogue entry is internally consistent", () => {
    expect(MODELS.length).toBeGreaterThan(0)
    expect(getModel(DEFAULT_MODEL_ID)).toBeDefined()

    for (const model of MODELS) {
      // Unreachable by every provider would be a dead row in the picker.
      expect(Object.keys(model.servedBy).length).toBeGreaterThan(0)

      // A defaultEffort outside the model's own list would be handed straight
      // to a provider that rejects it.
      if (model.efforts.length > 0) {
        expect(model.defaultEffort).not.toBeNull()
        expect(model.efforts).toContain(model.defaultEffort!)
      } else {
        expect(model.defaultEffort).toBeNull()
      }

      // Efforts must come from the shared vocabulary the AI SDK accepts.
      for (const effort of model.efforts) {
        expect(EFFORT_IDS).toContain(effort)
      }
    }
  })
})

describe("provider resolution", () => {
  it("throws rather than streaming when nothing is configured", () => {
    // The failure that used to look like a spinner quietly stopping.
    expect(() => resolveModelSelection(DEFAULT_MODEL_ID, undefined)).toThrow(
      /No AI provider is configured/
    )
  })

  it("prefers OpenAI when every key is present", () => {
    for (const k of KEYS) process.env[k] = "test-key"
    const selection = resolveModelSelection("gpt-5.6-luna", "low")
    expect(selection.providerId).toBe("openai")
    expect(selection.upstreamModelId).toBe("gpt-5.6-luna")
  })

  it("skips OpenAI for a model it does not serve, even with the key set", () => {
    // The check that matters: an OPENAI_API_KEY must not make Claude look
    // reachable through OpenAI. It has no `openai` entry in servedBy.
    process.env.OPENAI_API_KEY = "test-key"
    process.env.AI_GATEWAY_API_KEY = "test-key"
    const selection = resolveModelSelection("claude-sonnet-5", "medium")
    expect(selection.providerId).toBe("vercel-gateway")
    expect(selection.upstreamModelId).toBe("anthropic/claude-sonnet-5")
  })

  it("uses each provider's own slug for the same model", () => {
    // The gateway says xai/, OpenRouter says x-ai/. This is why servedBy exists.
    process.env.AI_GATEWAY_API_KEY = "test-key"
    expect(resolveModelSelection("grok-4.5", undefined).upstreamModelId).toBe(
      "xai/grok-4.5"
    )

    delete process.env.AI_GATEWAY_API_KEY
    process.env.OPENROUTER_API_KEY = "test-key"
    expect(resolveModelSelection("grok-4.5", undefined).upstreamModelId).toBe(
      "x-ai/grok-4.5"
    )
  })

  it("falls back to the default model when the requested one is unreachable", () => {
    // Only OpenAI configured, and Gemini has no OpenAI route.
    process.env.OPENAI_API_KEY = "test-key"
    const selection = resolveModelSelection("gemini-3.5-flash", undefined)
    expect(selection.catalogueModel.id).toBe(DEFAULT_MODEL_ID)
    expect(selection.providerId).toBe("openai")
  })

  it("clamps an unsupported effort rather than passing it upstream", () => {
    process.env.AI_GATEWAY_API_KEY = "test-key"
    const selection = resolveModelSelection("deepseek-v4-flash", "none")
    expect(selection.effort).toBe("high")
  })
})
