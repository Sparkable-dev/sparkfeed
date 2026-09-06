import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto"
import { describe, expect, it } from "vitest"
import { verifyPlatformAssertion } from "../assertion"
import { safeLoginRedirect } from "@/lib/auth-redirect"

const { privateKey, publicKey } = generateKeyPairSync("ed25519")
const env = {
  SPARKFEED_EDITION: "cloud",
  SPARKFEED_ENVIRONMENT: "beta",
  SPARKFEED_DASHBOARD_PUBLIC_KEY: publicKey
    .export({ type: "spki", format: "pem" })
    .toString(),
}
const now = Date.parse("2026-09-05T12:00:00Z")
function request(body = "{}", changes: Record<string, unknown> = {}) {
  const claims = {
    iss: "sparkfeed-dashboard",
    aud: "sparkfeed-platform",
    sub: "staff-1",
    email: "operator@example.test",
    environment: "beta",
    method: "POST",
    path: "/api/internal/platform/mutations",
    bodyHash: createHash("sha256").update(body).digest("hex"),
    iat: now / 1000,
    exp: now / 1000 + 60,
    jti: randomUUID(),
    ...changes,
  }
  const data = Buffer.from(JSON.stringify(claims)).toString("base64url")
  return new Request(
    "https://app.example.test/api/internal/platform/mutations",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${data}.${sign(null, Buffer.from(data), privateKey).toString("base64url")}`,
      },
      body,
    }
  )
}
describe("operator service assertions", () => {
  it("accepts only the signed request binding", () =>
    expect(verifyPlatformAssertion(request(), "{}", env, now).sub).toBe(
      "staff-1"
    ))
  it.each([
    { environment: "production" },
    { method: "GET" },
    { path: "/api/internal/platform/users" },
    { iat: now / 1000 - 100 },
    { exp: now / 1000 },
    { exp: now / 1000 + 3600 },
    { iss: "customer" },
  ])("rejects invalid claims %j", (claims) =>
    expect(() =>
      verifyPlatformAssertion(request("{}", claims), "{}", env, now)
    ).toThrow("Invalid operator assertion")
  )
  it("rejects altered body, customer cookies and Community requests", () => {
    expect(() =>
      verifyPlatformAssertion(request(), '{"action":"ban_user"}', env, now)
    ).toThrow()
    expect(() =>
      verifyPlatformAssertion(
        new Request("https://app.example.test/api/internal/platform/users", {
          headers: { cookie: "sparkfeed-app.session_token=fake" },
        }),
        "",
        env,
        now
      )
    ).toThrow()
    expect(() =>
      verifyPlatformAssertion(
        request(),
        "{}",
        { ...env, SPARKFEED_EDITION: "community" },
        now
      )
    ).toThrow("Not found")
  })
  it("keeps redirects on the current host", () => {
    for (const unsafe of [
      "//evil.test",
      "/\\evil.test",
      "https://evil.test",
      "/\n/evil.test",
    ])
      expect(safeLoginRedirect(unsafe)).toBe("/")
    expect(safeLoginRedirect("/settings?tab=billing")).toBe(
      "/settings?tab=billing"
    )
  })
})
