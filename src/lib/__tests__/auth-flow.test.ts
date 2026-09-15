import { describe, expect, it } from "vitest"
import { getTestInstance } from "better-auth/test"
import { emailVerificationOptions } from "@/lib/auth-email-verification"
import {
  authSearch,
  safeLoginRedirect,
  verificationCallback,
} from "@/lib/auth-redirect"
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  fieldError,
} from "@/lib/auth-validation"

describe("auth destinations and validation", () => {
  it.each([
    "https://evil.test",
    "//evil.test",
    "/\\evil.test",
    "/a/../sign-in",
    "/%73ign-up",
    "/verify-email?redirect=/",
    "/api/auth/sign-out",
    "/bad%",
    "/\n/evil.test",
  ])("rejects unsafe or looping destination %s", (value) => {
    expect(safeLoginRedirect(value, "/discover")).toBe("/discover")
  })
  it("preserves internal share and invitation destinations through the callback", () => {
    const destination = "/invite?id=abc&email=reader%40example.test"
    const callback = new URL(
      verificationCallback(destination, "reader@example.test"),
      "https://app.test"
    )
    expect(callback.searchParams.get("redirect")).toBe(destination)
    expect(authSearch(Object.fromEntries(callback.searchParams)).email).toBe(
      "reader@example.test"
    )
  })
  it("validates names and email without imposing password composition rules", () => {
    expect(fieldError("name", "   ")).toBe("Enter your full name.")
    expect(fieldError("name", "李")).toBe("")
    expect(fieldError("email", "not-an-email")).toBe(
      "Enter a valid email address."
    )
    expect(fieldError("email", " reader@example.com ")).toBe("")
    expect(fieldError("password", "short")).toBe("Use at least 8 characters.")
    expect(fieldError("password", "long passphrase without symbols")).toBe("")
    expect(fieldError("password", "a".repeat(129))).toBe(
      "Use 128 characters or fewer."
    )
  })
})

describe("Better Auth verification and recovery", () => {
  it("verifies a new user, creates a session, retains the callback, and resets the password", async () => {
    const mail: Array<{ email: string; url: string }> = []
    let resetUrl = ""
    const { auth, client } = await getTestInstance(
      {
        emailAndPassword: {
          enabled: true,
          requireEmailVerification: true,
          minPasswordLength: PASSWORD_MIN_LENGTH,
          maxPasswordLength: PASSWORD_MAX_LENGTH,
          sendResetPassword: async ({ url }) => {
            resetUrl = url
          },
        },
        emailVerification: emailVerificationOptions(async (email, url) => {
          mail.push({ email, url })
        }),
      },
      { disableTestUser: true }
    )
    const email = "reader@example.com"
    const callbackURL = verificationCallback("/discover", email)
    const created = await client.signUp.email({
      email,
      name: "Reader",
      password: "sample password for tests",
      callbackURL,
    })
    expect(created.error).toBeNull()
    expect(created.data?.token).toBeNull()
    expect(mail).toHaveLength(1)
    const link = new URL(mail[0].url)
    expect(link.searchParams.get("callbackURL")).toBe(callbackURL)
    expect(
      (
        await client.signIn.email({
          email,
          password: "sample password for tests",
        })
      ).error?.code
    ).toBe("EMAIL_NOT_VERIFIED")
    const response = await auth.handler(new Request(link))
    expect(response.status).toBe(302)
    expect(response.headers.get("location")).toBe(callbackURL)
    const cookies = response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ")
    expect(cookies).toContain("session_token=")
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: cookies }),
    })
    expect(session?.user.emailVerified).toBe(true)
    expect(session?.user.email).toBe(email)
    expect(
      (
        await client.signIn.email({
          email,
          password: "sample password for tests",
        })
      ).data?.user.emailVerified
    ).toBe(true)
    const invalid = new URL(link)
    invalid.searchParams.set("token", "invalid")
    const badResponse = await auth.handler(new Request(invalid))
    expect(badResponse.status).toBe(302)
    expect(badResponse.headers.get("location")).toContain("error=INVALID_TOKEN")
    // Reusing a valid link does not create a fresh session in another browser.
    const reused = await auth.handler(new Request(link))
    expect(reused.headers.getSetCookie().join(";")).not.toContain(
      "session_token="
    )
    await client.requestPasswordReset({ email, redirectTo: "/reset-password" })
    const resetRedirect = await auth.handler(new Request(resetUrl))
    const resetToken = new URL(
      resetRedirect.headers.get("location")!,
      "http://localhost:3000"
    ).searchParams.get("token")!
    expect(
      (
        await client.resetPassword({
          token: resetToken,
          newPassword: "another test passphrase",
        })
      ).error
    ).toBeNull()
    expect(
      (
        await client.signIn.email({
          email,
          password: "another test passphrase",
        })
      ).error
    ).toBeNull()
    expect(
      (
        await client.resetPassword({
          token: resetToken,
          newPassword: "yet another passphrase",
        })
      ).error
    ).not.toBeNull()
  })
  it("does not swallow delivery failures", async () => {
    const options = emailVerificationOptions(async () => {
      throw new Error("mail unavailable")
    })
    await expect(
      options.sendVerificationEmail({
        user: { email: "reader@example.com" },
        url: "https://app.test/api/auth/verify-email?token=test",
      })
    ).rejects.toThrow("mail unavailable")
  })
})
