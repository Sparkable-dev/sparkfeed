const authPaths = new Set([
  "/login",
  "/signup",
  "/sign-in",
  "/sign-up",
  "/verify-email",
  "/forgot-password",
  "/reset-password",
])

export function safeLoginRedirect(value: unknown, fallback = "/") {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    (value.includes("\\") || [...value].some(character => character.charCodeAt(0) <= 32))
  )
    return fallback
  try {
    const url = new URL(value, "https://sparkfeed.invalid")
    const path = decodeURIComponent(url.pathname).replace(/\/+$/, "") || "/"
    if (
      url.origin !== "https://sparkfeed.invalid" ||
      authPaths.has(path) ||
      path.startsWith("/api/") ||
      (path.includes("\\") || [...path].some(character => character.charCodeAt(0) < 32))
    )
      return fallback
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}

export function authHref(
  path: string,
  values: Record<string, string | undefined> = {}
) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(values))
    if (value) query.set(key, value)
  return path + (query.size ? `?${query}` : "")
}

export type AuthSearch = Partial<
  Record<"redirect" | "email" | "info" | "token" | "error" | "verified", string>
>

export function authSearch(search: Record<string, unknown>): AuthSearch {
  const value = (key: string) =>
    typeof search[key] === "string" ? (search[key]) : undefined
  return {
    redirect: value("redirect"),
    email: value("email"),
    info: value("info"),
    token: value("token"),
    error: value("error"),
    verified: value("verified"),
  }
}

export function verificationCallback(redirect: string, email?: string) {
  return authHref("/verify-email", {
    redirect: safeLoginRedirect(redirect, "/discover"),
    email,
    verified: "1",
  })
}
