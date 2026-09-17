import { createServerFn } from "@tanstack/react-start"
import { sparkfeedEdition } from "./entitlements/config"
import { resolveWorkspaceContext } from "./services/context"
import { principalFromWorkspaceContext } from "./ai/principal"

export interface SparkAiCreditSummary {
  balance: number | null
  plan: string
}

export const getSparkAiCreditSummary = createServerFn({
  method: "GET",
}).handler(async (): Promise<SparkAiCreditSummary> => {
  if (sparkfeedEdition() !== "cloud") {
    return { balance: null, plan: "community" }
  }
  const context = await resolveWorkspaceContext()
  if (!context.workspace || !context.userId) {
    return { balance: 0, plan: "free" }
  }
  const principal = await principalFromWorkspaceContext(context)
  return {
    balance: principal.entitlements?.sparkAiCreditBalance ?? 0,
    plan: principal.entitlements?.plan ?? "free",
  }
})
