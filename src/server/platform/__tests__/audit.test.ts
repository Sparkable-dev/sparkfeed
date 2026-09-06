import { describe, expect, it } from "vitest"
import { redactAuditValue, requireAuditReason } from "../audit-values"

describe("admin audit data", () => {
  it("requires a reason and redacts sensitive fields recursively", () => {
    expect(() => requireAuditReason("   ")).toThrow("non-empty audit reason")
    expect(requireAuditReason("  customer request  ")).toBe("customer request")
    expect(
      redactAuditValue({
        email: "person@example.com",
        token: "session-secret",
        nested: { webhookSignature: "signed", plan: "enterprise" },
      })
    ).toEqual({
      email: "person@example.com",
      token: "[REDACTED]",
      nested: { webhookSignature: "[REDACTED]", plan: "enterprise" },
    })
  })
})
