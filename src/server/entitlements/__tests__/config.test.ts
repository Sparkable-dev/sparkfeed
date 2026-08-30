import { afterEach, describe, expect, it } from "vitest"
import { readSparkfeedDeploymentConfig } from "../config"

describe("Sparkfeed deployment configuration", () => {
  afterEach(() => {
    delete process.env.DODO_API_KEY
    delete process.env.DODO_WEBHOOK_SECRET
  })

  it("defaults to the Community app without any Dodo settings", () => {
    expect(readSparkfeedDeploymentConfig({})).toEqual({
      edition: "community",
      surface: "app",
    })
  })

  it("accepts both Cloud deployment surfaces before billing is installed", () => {
    expect(
      readSparkfeedDeploymentConfig({
        SPARKFEED_EDITION: "cloud",
        SPARKFEED_SURFACE: "admin",
      })
    ).toEqual({ edition: "cloud", surface: "admin" })
  })

  it("rejects unknown editions, surfaces, and a Community admin surface", () => {
    expect(() =>
      readSparkfeedDeploymentConfig({ SPARKFEED_EDITION: "hosted" })
    ).toThrow("SPARKFEED_EDITION")
    expect(() =>
      readSparkfeedDeploymentConfig({ SPARKFEED_SURFACE: "worker" })
    ).toThrow("SPARKFEED_SURFACE")
    expect(() =>
      readSparkfeedDeploymentConfig({
        SPARKFEED_EDITION: "community",
        SPARKFEED_SURFACE: "admin",
      })
    ).toThrow("only valid")
  })
})
