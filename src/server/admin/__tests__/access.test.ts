import { describe, expect, it } from "vitest"
import {
  PlatformAdminHttpError,
  assertPlatformAdminSurface,
  platformAdminIsExposed,
} from "../access"
import { redactAuditValue, requireAuditReason } from "../audit-values"
import { platformAdminRole, regularUserRole } from "@/lib/admin-permissions"
import {
  platformTwoFactorOptions,
  resolveAuthSurfaceConfig,
} from "@/lib/admin-auth"

describe("platform-admin exposure and Better Auth permissions", () => {
  it("returns a not-found boundary outside the Cloud admin service", () => {
    expect(
      platformAdminIsExposed({
        SPARKFEED_EDITION: "cloud",
        SPARKFEED_SURFACE: "admin",
      })
    ).toBe(true)
    expect(
      platformAdminIsExposed({
        SPARKFEED_EDITION: "cloud",
        SPARKFEED_SURFACE: "app",
      })
    ).toBe(false)
    expect(
      platformAdminIsExposed({
        SPARKFEED_EDITION: "community",
        SPARKFEED_SURFACE: "app",
      })
    ).toBe(false)
    expect(() =>
      assertPlatformAdminSurface({
        SPARKFEED_EDITION: "cloud",
        SPARKFEED_SURFACE: "app",
      })
    ).toThrow(PlatformAdminHttpError)
  })

  it("allows only approved Better Auth Admin operations", () => {
    expect(
      platformAdminRole.authorize({ user: ["list", "get", "ban"] }).success
    ).toBe(true)
    expect(
      platformAdminRole.authorize({ session: ["list", "revoke"] }).success
    ).toBe(true)
    for (const denied of [
      "impersonate",
      "delete",
      "set-password",
      "set-role",
      "create",
    ] as const) {
      expect(platformAdminRole.authorize({ user: [denied] }).success).toBe(
        false
      )
    }
    expect(regularUserRole.authorize({ user: ["list"] }).success).toBe(false)
  })

  it("keeps TOTP enrollment verified, backup codes enabled, lockout on, and trust at 30 days", () => {
    expect(platformTwoFactorOptions).toMatchObject({
      issuer: "Sparkfeed Admin",
      skipVerificationOnEnable: false,
      trustDeviceMaxAge: 2_592_000,
      accountLockout: {
        enabled: true,
        maxFailedAttempts: 10,
        durationSeconds: 900,
      },
    })
  })

  it("uses separate host-only cookie prefixes and exact trusted origins", () => {
    const app = resolveAuthSurfaceConfig({
      NODE_ENV: "production",
      SPARKFEED_EDITION: "cloud",
      SPARKFEED_SURFACE: "app",
    })
    const admin = resolveAuthSurfaceConfig({
      NODE_ENV: "production",
      SPARKFEED_EDITION: "cloud",
      SPARKFEED_SURFACE: "admin",
    })
    expect(app).toMatchObject({
      cookiePrefix: "sparkfeed-app",
      trustedOrigins: ["https://app.sparkfeed.dev"],
    })
    expect(admin).toMatchObject({
      cookiePrefix: "sparkfeed-admin",
      trustedOrigins: ["https://admin.sparkfeed.dev"],
    })
    expect(() =>
      resolveAuthSurfaceConfig({
        NODE_ENV: "production",
        SPARKFEED_EDITION: "cloud",
        SPARKFEED_SURFACE: "admin",
        BETTER_AUTH_URL: "https://app.sparkfeed.dev",
      })
    ).toThrow("must match the admin service origin")
  })
})

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
