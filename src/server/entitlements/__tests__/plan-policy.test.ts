import { describe, expect, it } from "vitest"
import { sparkAiPlanPolicy } from "../plan-policy"

describe("Spark AI plan policy", () => {
  it("uses the approved Cloud allowances and three-month caps", () => {
    expect(sparkAiPlanPolicy("free")).toEqual({
      monthlyCredits: 0,
      rolloverCap: 50,
    })
    expect(sparkAiPlanPolicy("personal_plus")).toEqual({
      monthlyCredits: 150,
      rolloverCap: 450,
    })
    expect(sparkAiPlanPolicy("pro")).toEqual({
      monthlyCredits: 360,
      rolloverCap: 1080,
    })
  })
})
