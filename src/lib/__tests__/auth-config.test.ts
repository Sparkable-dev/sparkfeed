import { describe, expect, it } from "vitest"
import { resolveAuthConfig } from "../auth-config"
import { customerAccountSecurity } from "../auth-security"

describe("customer authentication configuration", () => {
  it("uses a self-hosted origin without a hosted admin domain", () => {
    expect(
      resolveAuthConfig({
        APP_URL: "https://reader.example.test",
        NODE_ENV: "production",
      })
    ).toEqual({
      configuredOrigin: "https://reader.example.test",
      trustedOrigins: ["https://reader.example.test"],
      cookiePrefix: "sparkfeed-app",
    })
  })
  it("rejects a mismatched auth origin in production", () => {
    expect(() =>
      resolveAuthConfig({
        NODE_ENV: "production",
        APP_URL: "https://reader.example.test",
        BETTER_AUTH_URL: "https://other.example.test",
      })
    ).toThrow("must match")
  })
  it("registers ban hooks without any Admin API endpoints", () => {
    const plugin = customerAccountSecurity()
    expect(Object.keys(plugin.endpoints)).toEqual([])
    expect(plugin.init).toBeTypeOf("function")
  })
})
