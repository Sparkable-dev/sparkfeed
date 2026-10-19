import { afterEach, describe, expect, it, vi } from "vitest"
import { getTestInstance } from "better-auth/test"
import { resolveSocialProviders, socialAccountOptions } from "../social-auth"

afterEach(() => vi.restoreAllMocks())

describe("social provider configuration", () => {
  it("does not enable an unconfigured provider and rejects partial credentials", () => {
    expect(resolveSocialProviders({})).toEqual({})
    expect(() => resolveSocialProviders({ GOOGLE_CLIENT_ID: "id" })).toThrow(
      "must both"
    )
    expect(
      resolveSocialProviders({
        GOOGLE_CLIENT_ID: "id",
        GOOGLE_CLIENT_SECRET: "secret",
      })
    ).toEqual({ google: { clientId: "id", clientSecret: "secret" } })
  })
})

async function fixture() {
  let profile = {
    sub: "google-user-1",
    email: "test@test.com",
    email_verified: true,
    name: "Google Name",
    aud: "test-client",
    azp: "test-client",
    iss: "https://accounts.google.com",
    exp: 2_000_000_000,
    iat: 1_900_000_000,
    given_name: "Google",
    family_name: "Name",
    picture: "https://example.test/avatar.png",
    locale: "en",
  }
  const instance = await getTestInstance(
    {
      account: socialAccountOptions,
      socialProviders: {
        google: {
          clientId: "test-client",
          clientSecret: "test-secret",
          verifyIdToken: () => Promise.resolve(true),
          getUserInfo: () => Promise.resolve({
            user: {
              email: profile.email,
              emailVerified: profile.email_verified,
              name: profile.name,
            },
            data: profile,
          }),
        },
        github: { clientId: "github-test-client", clientSecret: "github-test-secret" },
      },
    },
    { testUser: { emailVerified: true } }
  )
  // The test utility creates its credential user through signup, which ignores
  // caller-supplied verification. Mark ownership as proven in the fixture DB.
  await instance.db.update({
    model: "user",
    where: [{ field: "email", value: "test@test.com" }],
    update: { emailVerified: true },
  })
  return {
    ...instance,
    setProfile: (value: Partial<typeof profile>) => {
      profile = { ...profile, ...value }
    },
  }
}
const idToken = { token: "mock-verified-provider-token" }

describe("Better Auth social account ownership", () => {
  it("completes the GitHub authorization callback using a verified private email", async () => {
    const { auth, db, signInWithTestUser } = await fixture()
    const original = await signInWithTestUser()
    const begin = await auth.api.signInSocial({ body: { provider: "github", callbackURL: "/discover", disableRedirect: true }, asResponse: true })
    const authorization = new URL((await begin.json()).url)
    expect(authorization.searchParams.get("scope")).toContain("user:email")
    expect(authorization.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/auth/callback/github")
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input)
      if (url === "https://github.com/login/oauth/access_token") return Promise.resolve(Response.json({ access_token: "github-test-token", token_type: "bearer", scope: "read:user,user:email" }))
      if (url === "https://api.github.com/user") return Promise.resolve(Response.json({ id: 1234, name: "GitHub Reader", login: "reader", email: null }))
      if (url === "https://api.github.com/user/emails") return Promise.resolve(Response.json([{ email: "test@test.com", primary: true, verified: true }]))
      throw new Error(`Unexpected OAuth test request: ${url}`)
    })
    const cookie = begin.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ")
    const callback = await auth.handler(new Request(`http://localhost:3000/api/auth/callback/github?code=test-code&state=${encodeURIComponent(authorization.searchParams.get("state")!)}`, { headers: { cookie } }))
    expect(callback.status).toBe(302)
    expect(callback.headers.get("location")).toBe("/discover")
    expect(await db.count({ model: "user" })).toBe(1)
    const methods = await auth.api.listUserAccounts({ headers: original.headers })
    expect(methods.some((method) => method.providerId === "github")).toBe(true)
  })
  it("links a verified same-email identity without creating a second user", async () => {
    const { auth, client, db, signInWithTestUser } = await fixture()
    const original = await signInWithTestUser()
    const signedIn = await client.signIn.social({ provider: "google", idToken })
    expect(signedIn.error).toBeNull()
    expect(
      signedIn.data && "user" in signedIn.data && signedIn.data.user.id
    ).toBe(original.user.id)
    expect(
      signedIn.data && "user" in signedIn.data && signedIn.data.user.name
    ).toBe(original.user.name)
    expect(await db.count({ model: "user" })).toBe(1)
    const methods = await auth.api.listUserAccounts({
      headers: original.headers,
    })
    expect(methods.map((method) => method.providerId).sort()).toEqual([
      "credential",
      "google",
    ])
  })
  it("requires the existing local email to be verified before implicit linking", async () => {
    const { client, db } = await fixture()
    await db.update({
      model: "user",
      where: [{ field: "email", value: "test@test.com" }],
      update: { emailVerified: false },
    })
    const result = await client.signIn.social({ provider: "google", idToken })
    expect(result.error?.code).toBe("OAUTH_LINK_ERROR")
    expect(await db.count({ model: "account" })).toBe(1)
  })
  it("rejects an unverified provider email even when the local email is verified", async () => {
    const { client, db, setProfile } = await fixture()
    setProfile({ email_verified: false })
    const result = await client.signIn.social({ provider: "google", idToken })
    expect(result.error?.code).toBe("OAUTH_LINK_ERROR")
    expect(await db.count({ model: "account" })).toBe(1)
  })
  it("requires a session for explicit linking, permits a different verified email, and retains the profile", async () => {
    const { auth, client, signInWithTestUser, setProfile } = await fixture()
    setProfile({ email: "other@example.test" })
    expect(
      (await client.linkSocial({ provider: "google", idToken })).error
    ).toBeTruthy()
    const original = await signInWithTestUser()
    await original.runWithUser(async () => {
      const linked = await client.linkSocial({ provider: "google", idToken })
      expect(linked.error).toBeNull()
    })
    const current = await auth.api.getSession({ headers: original.headers })
    expect(current?.user.email).toBe("test@test.com")
    expect(current?.user.name).toBe(original.user.name)
    const signedIn = await client.signIn.social({ provider: "google", idToken })
    expect(
      signedIn.data && "user" in signedIn.data && signedIn.data.user.id
    ).toBe(original.user.id)
  })
  it("cannot link a provider already owned by another user", async () => {
    const { client, signInWithTestUser, setProfile } = await fixture()
    setProfile({ email: "other@example.test" })
    const other = await client.signIn.social({ provider: "google", idToken })
    expect(other.error).toBeNull()
    const original = await signInWithTestUser()
    await original.runWithUser(async () => {
      expect(
        (await client.linkSocial({ provider: "google", idToken })).error?.code
      ).toBe("SOCIAL_ACCOUNT_ALREADY_LINKED")
    })
  })
  it("uses local account IDs to unlink and refuses removal of the last method", async () => {
    const { client, signInWithTestUser } = await fixture()
    const original = await signInWithTestUser()
    await original.runWithUser(async () => {
      await client.linkSocial({ provider: "google", idToken })
      const methods = await client.listAccounts()
      const google = methods.data!.find(
        (method) => method.providerId === "google"
      )!
      expect(
        (await client.unlinkAccount({ accountId: google.id })).error
      ).toBeNull()
      const remaining = await client.listAccounts()
      expect(remaining.data).toHaveLength(1)
      expect(
        (await client.unlinkAccount({ accountId: remaining.data![0].id })).error
          ?.code
      ).toBe("FAILED_TO_UNLINK_LAST_ACCOUNT")
    })
  })
})
