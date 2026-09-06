const SENSITIVE_KEY =
  /password|secret|token|signature|authorization|cookie|rawbody|payload|card|bank|routing|accountnumber|cvv|cvc/i

export function requireAuditReason(reason: unknown): string {
  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw new Error("A non-empty audit reason is required.")
  }
  return reason.trim().slice(0, 500)
}

export function redactAuditValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[REDACTED:DEPTH]"
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value
  }
  if (typeof value === "string") return value.slice(0, 1_000)
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "[INVALID_DATE]" : value.toISOString()
  }
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => redactAuditValue(item, depth + 1))
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 100)
        .map(([key, item]) => [
          key,
          SENSITIVE_KEY.test(key)
            ? "[REDACTED]"
            : redactAuditValue(item, depth + 1),
        ])
    )
  }
  return String(value).slice(0, 1_000)
}
