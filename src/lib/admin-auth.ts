import { readSparkfeedDeploymentConfig } from "@/server/entitlements/config"

export const platformTwoFactorOptions = {
  issuer: "Sparkfeed Admin",
  skipVerificationOnEnable: false,
  trustDeviceMaxAge: 60 * 60 * 24 * 30,
  accountLockout: {
    enabled: true,
    maxFailedAttempts: 10,
    durationSeconds: 15 * 60,
  },
} as const

export function resolveAuthSurfaceConfig(
  env: Record<string, string | undefined> = process.env
) {
  const deployment = readSparkfeedDeploymentConfig(env)
  const platformAdminEnabled =
    deployment.edition === "cloud" && deployment.surface === "admin"
  const configuredOrigin =
    deployment.surface === "admin"
      ? env.SPARKFEED_ADMIN_ORIGIN || "https://admin.sparkfeed.dev"
      : env.SPARKFEED_APP_ORIGIN || env.APP_URL || "https://app.sparkfeed.dev"
  const trustedOrigins = [
    configuredOrigin,
    ...(env.NODE_ENV === "production" ? [] : ["http://localhost:3000"]),
  ]

  if (env.NODE_ENV === "production" && env.BETTER_AUTH_URL) {
    const authOrigin = new URL(env.BETTER_AUTH_URL).origin
    if (authOrigin !== new URL(configuredOrigin).origin) {
      throw new Error(
        `[auth] BETTER_AUTH_URL must match the ${deployment.surface} service origin.`
      )
    }
  }

  return {
    deployment,
    platformAdminEnabled,
    configuredOrigin,
    trustedOrigins,
    cookiePrefix: platformAdminEnabled ? "sparkfeed-admin" : "sparkfeed-app",
  }
}
