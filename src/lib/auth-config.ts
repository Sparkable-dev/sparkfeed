/** Customer authentication has one origin and host-only cookies. */
export function resolveAuthConfig(
  env: Record<string, string | undefined> = process.env
) {
  const configuredOrigin = new URL(
    env.SPARKFEED_APP_ORIGIN ||
      env.APP_URL ||
      env.BETTER_AUTH_URL ||
      "http://localhost:3000"
  ).origin
  if (
    env.NODE_ENV === "production" &&
    env.BETTER_AUTH_URL &&
    new URL(env.BETTER_AUTH_URL).origin !== configuredOrigin
  ) {
    throw new Error(
      "[auth] BETTER_AUTH_URL must match the customer application origin."
    )
  }
  return {
    configuredOrigin,
    trustedOrigins: [configuredOrigin],
    cookiePrefix: "sparkfeed-app",
  }
}
