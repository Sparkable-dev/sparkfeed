import { describe, expect, it } from "vitest"
import { readSparkfeedDeploymentConfig } from "../config"

describe("Sparkfeed deployment configuration", () => {
  it("defaults to Community without Dodo settings", () => {
    expect(readSparkfeedDeploymentConfig({})).toEqual({ edition: "community" })
  })
  it("accepts Cloud independently of its optional private dashboard", () => {
    expect(
      readSparkfeedDeploymentConfig({ SPARKFEED_EDITION: "cloud" })
    ).toEqual({ edition: "cloud" })
  })
  it("rejects unknown editions", () => {
    expect(() =>
      readSparkfeedDeploymentConfig({ SPARKFEED_EDITION: "hosted" })
    ).toThrow("SPARKFEED_EDITION")
  })
})
