import { createServerFn } from "@tanstack/react-start"

/** Only provider names cross the server boundary, never OAuth credentials. */
export const getEnabledSocialProviders = createServerFn({
  method: "GET",
}).handler(async () => {
  const { resolveSocialProviders, socialProviders } =
    await import("@/lib/social-auth")
  if (import.meta.env.VITE_DEMO_MODE === "true") return []
  const configured = resolveSocialProviders()
  return socialProviders.filter((provider) => Boolean(configured[provider]))
})
