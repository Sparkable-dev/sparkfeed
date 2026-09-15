import { useState } from "react"
import type { FormEvent } from "react"
import type { AuthSearch } from "@/lib/auth-redirect"
import { useAuthValidation } from "@/components/auth/use-auth-validation"
import { authClient } from "@/lib/auth-client"
import { authHref, safeLoginRedirect } from "@/lib/auth-redirect"
import {
  AuthError,
  AuthLayout,
  FieldError,
  PasswordField,
  SocialButtons,
} from "@/components/auth/auth-ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"

export default function SignInForm({ search }: { search: AuthSearch }) {
  const validation = useAuthValidation()
  const [email, setEmail] = useState(search.email || "")
  const [password, setPassword] = useState("")
  const [rememberMe, setRememberMe] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const destination = safeLoginRedirect(search.redirect)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (loading) return
    if (
      !validation.validate([
        ["email", "email", email],
        ["password", "signInPassword", password],
      ])
    )
      return
    setLoading(true)
    setError("")
    try {
      const result = await authClient.signIn.email({
        email: email.trim(),
        password,
        rememberMe,
      })
      if (result.error) {
        if (result.error.code === "EMAIL_NOT_VERIFIED") {
          window.location.assign(
            authHref("/verify-email", {
              email: email.trim(),
              redirect: destination,
            })
          )
          return
        }
        setError(
          result.error.message ||
            "Unable to sign in. Check your email and password."
        )
      } else window.location.assign(destination)
    } catch {
      setError("Unable to connect. Please try again.")
    } finally {
      setLoading(false)
    }
  }
  return (
    <AuthLayout title="Welcome back">
      <SocialButtons action="sign-in" />
      {search.info && (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          {search.info === "password-reset"
            ? "Your password has been reset. Sign in with your new password."
            : "Sign-up is restricted on this instance. Use your invitation or contact your administrator."}
        </p>
      )}
      <form
        noValidate
        onSubmit={submit}
        className="mt-6 space-y-6"
        aria-busy={loading}
      >
        <AuthError message={error} />
        <div className="space-y-1.5">
          <Label htmlFor="email">Email address</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              validation.clearWhenValid("email", "email", e.target.value)
            }}
            onBlur={() => validation.check("email", "email", email)}
            aria-invalid={Boolean(validation.errors.email)}
            aria-describedby={
              validation.errors.email ? "email-error" : undefined
            }
            disabled={loading}
            placeholder="you@example.com"
            className="h-10 shadow-xs"
          />
          <FieldError id="email-error" message={validation.errors.email} />
        </div>
        <PasswordField
          value={password}
          onChange={(value) => {
            setPassword(value)
            validation.clearWhenValid("password", "signInPassword", value)
          }}
          onBlur={() =>
            validation.check("password", "signInPassword", password)
          }
          error={validation.errors.password}
          disabled={loading}
        />
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <div className="flex items-center gap-2">
            <Checkbox
              id="remember"
              checked={rememberMe}
              onCheckedChange={(checked) => setRememberMe(checked === true)}
              disabled={loading}
            />
            <Label htmlFor="remember" className="font-normal">
              Remember this device
            </Label>
          </div>
          <a href="/forgot-password" className="text-primary hover:underline dark:text-foreground dark:underline dark:decoration-primary dark:underline-offset-4">
            Forgot password?
          </a>
        </div>
        <Button
          type="submit"
          disabled={loading}
          className="h-10 w-full rounded-lg"
        >
          {loading ? "Signing in..." : "Sign in"}
        </Button>
      </form>
      <p className="mt-6 text-sm text-muted-foreground">
        New to Sparkfeed?{" "}
        <a
          href={authHref("/sign-up", {
            redirect: search.redirect ? destination : undefined,
            email: search.email,
          })}
          className="font-medium text-primary hover:underline dark:text-foreground dark:underline dark:decoration-primary dark:underline-offset-4"
        >
          Sign up
        </a>
      </p>
    </AuthLayout>
  )
}
