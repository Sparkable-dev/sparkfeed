import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { betterAuth } from "better-auth"
import { hashPassword } from "better-auth/crypto"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { organization as organizationPlugin } from "better-auth/plugins"
import { eq } from "drizzle-orm"
import type { Database } from "@/db/client"
import { customerAccountSecurity } from "@/lib/auth-security"
import { createDb } from "@/db/client"
import * as schema from "@/db/schema"
import { workspaceAccess, workspaceRoles } from "@/lib/workspace-roles"

let database: Database
vi.mock("@/db/index", () => ({
  get db() {
    return database
  },
}))
const { hostedDashboardPlugin } = await import("../hosted-auth")
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 })
const apiKey = "local-hosted-integration-test"
const uid = `hosted-qa-${randomUUID()}`
let auth: ReturnType<typeof createTestAuth>
function createTestAuth() {
  return betterAuth({
    baseURL: "http://localhost:3200",
    secret: "isolated-local-auth-test-secret-with-more-than-32-chars",
    database: drizzleAdapter(database, { provider: "pg", schema }),
    emailAndPassword: { enabled: true },
    plugins: [
      customerAccountSecurity(),
      organizationPlugin({
        creatorRole: "owner",
        ac: workspaceAccess,
        roles: workspaceRoles,
      }),
      hostedDashboardPlugin()!,
    ],
  })
}
function jwt(extra: Record<string, unknown> = {}) {
  const head = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT", kid: "qa-key" })
  ).toString("base64url")
  const now = Math.floor(Date.now() / 1000)
  const body = Buffer.from(
    JSON.stringify({
      iat: now,
      exp: now + 60,
      jti: randomUUID(),
      apiKeyHash: createHash("sha256").update(apiKey).digest("hex"),
      ...extra,
    })
  ).toString("base64url")
  return `${head}.${body}.${sign("RSA-SHA256", Buffer.from(`${head}.${body}`), keys.privateKey).toString("base64url")}`
}
function request(
  path: string,
  claims: Record<string, unknown>,
  body?: unknown
) {
  return new Request(`http://localhost:3200/api/auth${path}`, {
    method: body !== undefined ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${jwt(claims)}`,
      "content-type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}
describe.runIf(process.env.RUN_PLATFORM_POSTGRES_TESTS === "true")(
  "official dashboard adapter through native JWT middleware",
  () => {
    beforeAll(async () => {
      const url = process.env.DATABASE_URL
      if (!url || !new URL(url).pathname.endsWith("_qa"))
        throw new Error("Tests require disposable *_qa database")
      database = createDb(url)
      vi.stubEnv("SPARKFEED_EDITION", "cloud")
      vi.stubEnv("SPARKFEED_BETTER_AUTH_DASHBOARD", "true")
      vi.stubEnv("BETTER_AUTH_API_KEY", apiKey)
      vi.stubGlobal(
        "fetch",
        vi.fn((input: RequestInfo | URL) => {
          const requestUrl = String(
            input instanceof Request ? input.url : input
          )
          if (requestUrl.includes("/api/auth/jwks"))
            return Promise.resolve(
              Response.json({
                keys: [
                  {
                    ...keys.publicKey.export({ format: "jwk" }),
                    kid: "qa-key",
                    alg: "RS256",
                    use: "sig",
                  },
                ],
              })
            )
          return Promise.resolve(Response.json({ valid: true, success: true }))
        })
      )
      auth = createTestAuth()
      await database.insert(schema.user).values({
        id: uid,
        name: "Hosted QA",
        email: uid + "@example.test",
        emailVerified: true,
      })
      await database.insert(schema.account).values({
        id: uid + "-account",
        userId: uid,
        providerId: "credential",
        accountId: uid,
        issuer: "local:credential",
        password: await hashPassword("A-local-test-password-only-2026"),
        accessToken: "never-return-access-token",
        refreshToken: "never-return-refresh-token",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    })
    afterAll(async () => {
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
      if (database)
        await (
          database as unknown as { $client: { end: () => Promise<void> } }
        ).$client.end()
    })
    it("rejects an unsigned hosted request", async () => {
      const response = await auth.handler(
        new Request("http://localhost:3200/api/auth/dash/user")
      )
      expect(response.status).toBe(401)
    })
    it("uses the vendor verifier and strips account secrets", async () => {
      const response = await auth.handler(
        request("/dash/user", { userId: uid, accountOnly: true })
      )
      expect(response.status).toBe(200)
      const body = await response.text()
      expect(body).toContain(uid)
      expect(body).not.toContain("never-return")
      expect(body).not.toContain('"password"')
    })
    it("prevents generic adapter bypass", async () => {
      const response = await auth.handler(
        request(
          "/dash/execute-adapter",
          {},
          { action: "findMany", model: "account" }
        )
      )
      expect(response.status).toBe(403)
    })
    it("creates an isolated support session with a marker and bounded lifetime", async () => {
      const token = jwt({ userId: uid, redirectUrl: "http://localhost:3200/" })
      const response = await auth.handler(
        new Request(
          `http://localhost:3200/api/auth/dash/impersonate-user?impersonation_token=${token}`
        )
      )
      expect(response.status).toBe(302)
      const cookie = response.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; ")
      const current = await auth.api.getSession({
        headers: new Headers({ cookie }),
      })
      expect(current?.session.impersonatedBy).toBe(
        "integration:better-auth-dashboard"
      )
      expect(
        new Date(current!.session.expiresAt).getTime() - Date.now()
      ).toBeLessThanOrEqual(600000)
    })
    it("a legacy customer admin can sign in but cannot administer users or enroll TOTP", async () => {
      await database
        .update(schema.user)
        .set({ role: "admin" })
        .where(eq(schema.user.id, uid))
      const signedIn = await auth.handler(
        new Request("http://localhost:3200/api/auth/sign-in/email", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3200",
          },
          body: JSON.stringify({
            email: uid + "@example.test",
            password: "A-local-test-password-only-2026",
          }),
        })
      )
      expect(signedIn.status).toBe(200)
      expect(await signedIn.clone().text()).not.toContain("twoFactorRedirect")
      const cookie = signedIn.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; ")
      expect(
        (await auth.api.getSession({ headers: new Headers({ cookie }) }))?.user
          .id
      ).toBe(uid)
      for (const [path, method] of [
        ["/admin/list-users", "GET"],
        ["/admin/ban-user", "POST"],
        ["/two-factor/enable", "POST"],
      ]) {
        const response = await auth.handler(
          new Request(`http://localhost:3200/api/auth${path}`, {
            method,
            headers: {
              cookie,
              origin: "http://localhost:3200",
              "content-type": "application/json",
            },
            ...(method === "POST"
              ? { body: JSON.stringify({ userId: uid }) }
              : {}),
          })
        )
        expect(response.status).toBe(404)
      }
      await database
        .update(schema.user)
        .set({ role: "user" })
        .where(eq(schema.user.id, uid))
    })
    it("ban prevents a new session and unban retains the account", async () => {
      const response = await auth.handler(
        request(
          "/dash/ban-user",
          { userId: uid },
          { banReason: "QA", deleteAllSessions: true }
        )
      )
      expect(response.status).toBe(200)
      const [u] = await database
        .select()
        .from(schema.user)
        .where(eq(schema.user.id, uid))
      expect(u.banned).toBe(true)
      const blocked = await auth.handler(
        new Request("http://localhost:3200/api/auth/sign-in/email", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3200",
          },
          body: JSON.stringify({
            email: uid + "@example.test",
            password: "A-local-test-password-only-2026",
          }),
        })
      )
      expect(blocked.status).toBe(403)

      const unban = await auth.handler(
        request("/dash/unban-user", { userId: uid }, {})
      )
      expect(unban.status).toBe(200)
    })
  }
)
