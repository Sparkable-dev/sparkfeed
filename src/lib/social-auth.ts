export const socialProviders = ["google", "github"] as const
export type SocialProvider = (typeof socialProviders)[number]

export const socialProviderLabels: Record<SocialProvider, string> = {
  google: "Google",
  github: "GitHub",
}

/** Link only verified identities; a session is required for different emails. */
export const socialAccountOptions = {
  encryptOAuthTokens: true,
  accountLinking: {
    enabled: true,
    trustedProviders: [],
    requireLocalEmailVerified: true,
    allowDifferentEmails: true,
    allowUnlinkingAll: false,
    updateUserInfoOnLink: false,
  },
}

export function resolveSocialProviders(
  env: Record<string, string | undefined> = process.env
) {
  const providers: Partial<
    Record<SocialProvider, { clientId: string; clientSecret: string }>
  > = {}
  for (const provider of socialProviders) {
    // Hosted beta must never expose Google authentication, even if misconfigured.
    if (provider === "google" && env.SPARKFEED_ENVIRONMENT === "beta") continue
    const prefix = provider.toUpperCase()
    const clientId = env[`${prefix}_CLIENT_ID`]?.trim()
    const clientSecret = env[`${prefix}_CLIENT_SECRET`]?.trim()
    if (Boolean(clientId) !== Boolean(clientSecret)) {
      throw new Error(
        `${prefix}_CLIENT_ID and ${prefix}_CLIENT_SECRET must both be configured.`
      )
    }
    if (clientId && clientSecret)
      providers[provider] = { clientId, clientSecret }
  }
  return providers
}

export function socialAuthError(code?: string) {
  if (!code) return ""
  if (
    ["account_not_linked", "account not linked", "OAUTH_LINK_ERROR"].includes(
      code
    )
  )
    return "Sign in with your existing method and connect this provider in Settings → Security. If your email isn't verified yet, verify it first."
  if (
    ["social_account_already_linked", "SOCIAL_ACCOUNT_ALREADY_LINKED"].includes(
      code
    )
  )
    return "This provider is already connected to another Sparkfeed account. Sign in to that account to manage it."
  if (["session_not_fresh", "SESSION_NOT_FRESH"].includes(code))
    return "Please sign in again before changing your sign-in methods."
  if (["access_denied", "user_denied"].includes(code))
    return "The connection was cancelled. You can try again."
  return "We couldn't complete the connection. Please try again or use your existing sign-in method."
}
