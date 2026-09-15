import { useCallback, useEffect, useRef, useState } from "react"
import type { AuthSearch } from "@/lib/auth-redirect"
import { useAuthValidation } from "@/components/auth/use-auth-validation"
import { authClient } from "@/lib/auth-client"
import {
  authHref,
  safeLoginRedirect,
  verificationCallback,
} from "@/lib/auth-redirect"
import { AuthError, AuthLayout, FieldError } from "@/components/auth/auth-ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function VerifyEmail({ search }: { search: AuthSearch }) {
  const validation = useAuthValidation()
  const destination = safeLoginRedirect(search.redirect, "/discover")
  const [email, setEmail] = useState(search.email || "")
  const [busy, setBusy] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [message, setMessage] = useState("")
  const [error, setError] = useState(
    search.error
      ? "This verification link is invalid or expired. Request a new email below."
      : ""
  )
  const [checking, setChecking] = useState(
    Boolean(search.token || search.verified)
  )
  const [verified, setVerified] = useState(false)
  const verification = useRef<Promise<boolean> | null>(null)

  const checkSession = useCallback(async () => {
    const result = await authClient.getSession({
      query: { disableCookieCache: true },
    })
    if (result.error)
      throw new Error("Unable to check your session. Please try again.")
    if (
      result.data?.user.emailVerified &&
      (!search.email ||
        result.data.user.email.toLowerCase() === search.email.toLowerCase())
    ) {
      window.location.replace(destination)
      return true
    }
    return false
  }, [destination, search.email])

  useEffect(() => {
    let active = true
    async function initialize() {
      try {
        // Old emailed links still arrive here with a token. New links go through
        // Better Auth first. Keep the request stable across Strict Mode effects.
        if (search.token && !search.error) {
          verification.current ??= authClient
            .verifyEmail({ query: { token: search.token } })
            .then((result) => {
              if (result.error)
                throw new Error(
                  result.error.message || "This link is invalid or expired."
                )
              return true
            })
          await verification.current
          if (active) setVerified(true)
        }
        if (!active) return
        if (await checkSession()) return
        if (active && search.verified && !search.error)
          setMessage(
            "If you verified your email in another browser, sign in below to continue."
          )
      } catch (cause) {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : "Unable to verify your email. Request a new link."
          )
      } finally {
        if (active) {
          setChecking(false)
          if (search.token)
            window.history.replaceState(
              null,
              "",
              authHref("/verify-email", {
                email: search.email,
                redirect: destination,
              })
            )
        }
      }
    }
    void initialize()
    const onFocus = () => {
      void checkSession().catch(() => {})
    }
    window.addEventListener("focus", onFocus)
    return () => {
      active = false
      window.removeEventListener("focus", onFocus)
    }
  }, [
    search.token,
    search.verified,
    search.error,
    search.email,
    destination,
    checkSession,
  ])

  useEffect(() => {
    if (!cooldown) return
    const timer = window.setTimeout(
      () => setCooldown((value) => value - 1),
      1000
    )
    return () => window.clearTimeout(timer)
  }, [cooldown])

  async function resend(event: React.FormEvent) {
    event.preventDefault()
    if (
      busy ||
      cooldown ||
      !validation.validate([["verification-email", "email", email]])
    )
      return
    setBusy(true)
    setError("")
    setMessage("")
    try {
      const result = await authClient.sendVerificationEmail({
        email: email.trim(),
        callbackURL: verificationCallback(destination, email.trim()),
      })
      if (result.error)
        throw new Error(result.error.message || "Unable to resend the email.")
      setCooldown(60)
      setMessage(
        "If this account needs verification, a new link has been sent. Check your inbox and spam folder."
      )
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to send the email. Please try again."
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      title={
        checking
          ? "Verifying your email..."
          : verified
            ? "Email verified"
            : "Verify your email"
      }
    >
      <div className="mt-3 space-y-5" aria-busy={checking || busy}>
        <p className="text-sm text-muted-foreground">
          {verified
            ? "Your email is verified. Sign in to continue if your session is in another browser."
            : "Check your inbox and follow the verification link to finish creating your account."}
        </p>
        {search.email && (
          <p className="text-sm font-medium break-all">{search.email}</p>
        )}
        <AuthError message={error} />
        {message && (
          <p role="status" className="text-sm text-muted-foreground">
            {message}
          </p>
        )}
        {!checking && (
          <>
            <Button
              type="button"
              className="h-10 w-full rounded-lg"
              onClick={async () => {
                setChecking(true)
                setError("")
                try {
                  if (!(await checkSession()))
                    setMessage(
                      "No verified session found here yet. Follow the email link, or sign in if you verified in another browser."
                    )
                } catch {
                  setError("Unable to check your session. Please try again.")
                } finally {
                  setChecking(false)
                }
              }}
            >
              Continue
            </Button>
            <form noValidate onSubmit={resend} className="space-y-3">
              <Label htmlFor="verification-email">Email address</Label>
              <Input
                id="verification-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  validation.clearWhenValid(
                    "verification-email",
                    "email",
                    e.target.value
                  )
                }}
                onBlur={() =>
                  validation.check("verification-email", "email", email)
                }
                aria-invalid={Boolean(validation.errors["verification-email"])}
                aria-describedby={
                  validation.errors["verification-email"]
                    ? "verification-email-error"
                    : undefined
                }
                disabled={busy}
                placeholder="you@example.com"
              />
              <FieldError
                id="verification-email-error"
                message={validation.errors["verification-email"]}
              />
              <Button
                variant="outline"
                type="submit"
                className="w-full"
                disabled={busy || cooldown > 0}
              >
                {busy
                  ? "Sending..."
                  : cooldown
                    ? `Resend in ${cooldown}s`
                    : "Resend verification email"}
              </Button>
            </form>
          </>
        )}
        <p className="text-sm text-muted-foreground">
          <a
            href={authHref("/sign-in", { redirect: destination, email })}
            className="font-medium text-primary hover:underline dark:text-foreground dark:underline dark:decoration-primary dark:underline-offset-4"
          >
            Back to sign in
          </a>
        </p>
      </div>
    </AuthLayout>
  )
}
