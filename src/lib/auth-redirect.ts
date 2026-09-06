export function safeLoginRedirect(value: unknown, fallback = "/") {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    (value.includes("\\") || [...value].some(character => character.charCodeAt(0) < 32))
  )
    return fallback
  return value
}
