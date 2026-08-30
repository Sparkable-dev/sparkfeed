import { readSparkfeedDeploymentConfig } from "@/server/entitlements/config"

export const PERSONAL_BILLING_INTERVALS = ["monthly", "annual"] as const
export type PersonalBillingInterval =
  (typeof PERSONAL_BILLING_INTERVALS)[number]

export type DodoEnvironment = "test_mode" | "live_mode"

export interface DodoBillingConfig {
  apiKey: string
  webhookSecret: string
  environment: DodoEnvironment
  appUrl: string
  personalProducts: Record<PersonalBillingInterval, string>
}

function required(
  env: Record<string, string | undefined>,
  name: string
): string {
  const value = env[name]?.trim()
  if (value) return value
  throw new Error(`[billing] ${name} is required for Sparkfeed Cloud.`)
}

export function readDodoBillingConfig(
  env: Record<string, string | undefined> = process.env
): DodoBillingConfig | null {
  if (readSparkfeedDeploymentConfig(env).edition === "community") return null

  const rawEnvironment = required(env, "DODO_PAYMENTS_ENVIRONMENT")
  if (rawEnvironment !== "test_mode" && rawEnvironment !== "live_mode") {
    throw new Error(
      "[billing] DODO_PAYMENTS_ENVIRONMENT must be test_mode or live_mode."
    )
  }

  const appUrl = required(env, "APP_URL")
  const parsedAppUrl = new URL(appUrl)
  if (rawEnvironment === "live_mode" && parsedAppUrl.protocol !== "https:") {
    throw new Error("[billing] APP_URL must use https in Dodo live mode.")
  }

  return {
    apiKey: required(env, "DODO_PAYMENTS_API_KEY"),
    webhookSecret: required(env, "DODO_PAYMENTS_WEBHOOK_SECRET"),
    environment: rawEnvironment,
    appUrl: parsedAppUrl.origin,
    personalProducts: {
      monthly: required(env, "DODO_PERSONAL_MONTHLY_PRODUCT_ID"),
      annual: required(env, "DODO_PERSONAL_ANNUAL_PRODUCT_ID"),
    },
  }
}

export function productForPersonalInterval(
  config: DodoBillingConfig,
  interval: PersonalBillingInterval
): string {
  return config.personalProducts[interval]
}

export function personalIntervalForProduct(
  config: DodoBillingConfig,
  productId: string
): PersonalBillingInterval | null {
  if (productId === config.personalProducts.monthly) return "monthly"
  if (productId === config.personalProducts.annual) return "annual"
  return null
}
