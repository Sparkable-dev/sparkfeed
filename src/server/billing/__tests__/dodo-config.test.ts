import { describe, expect, it } from "vitest"
import {
  personalIntervalForProduct,
  readDodoBillingConfig,
} from "../dodo-config"

const cloud = {
  SPARKFEED_EDITION: "cloud",
  APP_URL: "https://app.sparkfeed.dev",
  DODO_PAYMENTS_ENVIRONMENT: "test_mode",
  DODO_PAYMENTS_API_KEY: "test-key",
  DODO_PAYMENTS_WEBHOOK_SECRET: "test-webhook-secret",
  DODO_PERSONAL_MONTHLY_PRODUCT_ID: "product-monthly",
  DODO_PERSONAL_ANNUAL_PRODUCT_ID: "product-annual",
}

describe("Dodo billing configuration", () => {
  it("does not read Dodo settings in Community Edition", () => {
    expect(readDodoBillingConfig({ SPARKFEED_EDITION: "community" })).toBeNull()
  })

  it("fails closed when a Cloud billing setting is missing", () => {
    const { DODO_PAYMENTS_WEBHOOK_SECRET: _, ...missingWebhook } = cloud
    expect(() => readDodoBillingConfig(missingWebhook)).toThrow(
      "DODO_PAYMENTS_WEBHOOK_SECRET"
    )
  })

  it("requires HTTPS in live mode", () => {
    expect(() =>
      readDodoBillingConfig({
        ...cloud,
        DODO_PAYMENTS_ENVIRONMENT: "live_mode",
        APP_URL: "http://app.sparkfeed.dev",
      })
    ).toThrow("https")
  })

  it("maps only the configured Personal+ products", () => {
    const config = readDodoBillingConfig(cloud)
    expect(config).not.toBeNull()
    expect(personalIntervalForProduct(config!, "product-monthly")).toBe(
      "monthly"
    )
    expect(personalIntervalForProduct(config!, "product-annual")).toBe("annual")
    expect(personalIntervalForProduct(config!, "product-pro")).toBeNull()
  })
})
