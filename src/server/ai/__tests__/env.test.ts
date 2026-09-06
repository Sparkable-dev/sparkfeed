import { afterEach, describe, expect, it, vi } from "vitest"
import { aiDisabled, isDemo } from "../env"

const build = vi.hoisted(() => ({ demo: false }))
vi.mock("@tanstack/react-start", () => ({
  createServerOnlyFn: (fn: unknown) => fn,
}))
vi.mock("@/lib/demo", () => ({
  get DEMO_MODE() {
    return build.demo
  },
}))

afterEach(() => {
  build.demo = false
  vi.unstubAllEnvs()
})

describe("demo and AI deployment flags", () => {
  it("keeps AI locked in a demo build even when runtime demo is false", () => {
    build.demo = true
    vi.stubEnv("VITE_DEMO_MODE", "false")
    vi.stubEnv("DISABLE_AI", "false")
    expect(isDemo()).toBe(true)
    expect(aiDisabled()).toBe(true)
  })

  it("locks AI with the single runtime demo variable", () => {
    vi.stubEnv("VITE_DEMO_MODE", "true")
    vi.stubEnv("DISABLE_AI", "false")
    expect(isDemo()).toBe(true)
    expect(aiDisabled()).toBe(true)
  })

  it("allows AI in a normal deployment without the legacy variable", () => {
    vi.stubEnv("VITE_DEMO_MODE", "false")
    vi.stubEnv("DISABLE_AI", "false")
    vi.stubEnv("DEMO_MODE", undefined)
    expect(isDemo()).toBe(false)
    expect(aiDisabled()).toBe(false)
  })

  it("disables AI independently without changing the demo status", () => {
    vi.stubEnv("VITE_DEMO_MODE", "false")
    vi.stubEnv("DISABLE_AI", "true")
    expect(isDemo()).toBe(false)
    expect(aiDisabled()).toBe(true)
  })
})
