import * as React from "react"

export interface SparkAiCreditContextValue {
  balance: number | null
  refreshing: boolean
}

export const SparkAiCreditContext =
  React.createContext<SparkAiCreditContextValue>({
    balance: null,
    refreshing: false,
  })

export function useSparkAiCredits() {
  return React.useContext(SparkAiCreditContext)
}
