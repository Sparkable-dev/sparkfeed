import type { PlanKey } from "./types"

export const SPARK_AI_CREDITS_PER_USD = 100
export const FREE_SPARK_AI_CREDITS = 50
export const PERSONAL_PLUS_MONTHLY_SPARK_AI_CREDITS = 150
export const PRO_MONTHLY_SPARK_AI_CREDITS_PER_MEMBER = 360

export interface SparkAiPlanPolicy {
  monthlyCredits: number | null
  rolloverCap: number | null
}

export function sparkAiPlanPolicy(plan: PlanKey): SparkAiPlanPolicy {
  switch (plan) {
    case "free":
      return { monthlyCredits: 0, rolloverCap: FREE_SPARK_AI_CREDITS }
    case "personal_plus":
      return {
        monthlyCredits: PERSONAL_PLUS_MONTHLY_SPARK_AI_CREDITS,
        rolloverCap: PERSONAL_PLUS_MONTHLY_SPARK_AI_CREDITS * 3,
      }
    case "pro":
      return {
        monthlyCredits: PRO_MONTHLY_SPARK_AI_CREDITS_PER_MEMBER,
        rolloverCap: PRO_MONTHLY_SPARK_AI_CREDITS_PER_MEMBER * 3,
      }
    case "enterprise":
      return { monthlyCredits: null, rolloverCap: null }
  }
}
