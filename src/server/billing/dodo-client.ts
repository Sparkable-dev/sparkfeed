import DodoPayments from "dodopayments"
import { readDodoBillingConfig } from "./dodo-config"
import type { DodoBillingConfig } from "./dodo-config"

let cached:
  { apiKey: string; environment: string; client: DodoPayments } | undefined

export function createDodoClient(config: DodoBillingConfig): DodoPayments {
  return new DodoPayments({
    bearerToken: config.apiKey,
    webhookKey: config.webhookSecret,
    environment: config.environment,
  })
}

export function dodoClient(): DodoPayments {
  const config = readDodoBillingConfig()
  if (!config) {
    throw new Error("Dodo Payments is not available in Community Edition.")
  }

  if (
    cached?.apiKey === config.apiKey &&
    cached.environment === config.environment
  ) {
    return cached.client
  }

  const client = createDodoClient(config)
  cached = { apiKey: config.apiKey, environment: config.environment, client }
  return client
}
