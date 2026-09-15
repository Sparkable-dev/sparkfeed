import { useState } from "react"
import type { FormEvent } from "react"
import type { AuthSearch } from "@/lib/auth-redirect"
import { useAuthValidation } from "@/components/auth/use-auth-validation"
import { authClient } from "@/lib/auth-client"
import {
  authHref,
  safeLoginRedirect,
  verificationCallback,
} from "@/lib/auth-redirect"
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

export default function SignUpForm({ search }: { search: AuthSearch }) {
  const [name, setName] = useState("")
  const validation = useAuthValidation()
  const [email, setEmail] = useState(search.email || "")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const destination = safeLoginRedirect(search.redirect, "/discover")
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (loading) return
    if (
      !validation.validate([
        ["name", "name", name],
        ["email", "email", email],
        ["password", "password", password],
      ])
    )
      return
    if (!name.trim()) {
      setError("Enter your full name.")
      return
    }
    setLoading(true)
    setError("")
    try {
      const result = await authClient.signUp.email({
        name: name.trim(),
        email: email.trim(),
        password,
        callbackURL: verificationCallback(destination, email.trim()),
      })
      if (result.error)
        setError(
          result.error.message ||
            "Unable to create your account. Please try again."
        )
      else
        window.location.assign(
          authHref("/verify-email", {
            email: email.trim(),
            redirect: destination,
          })
        )
    } catch {
      setError("Unable to connect. Please try again.")
    } finally {
      setLoading(false)
    }
  }
  return (
    <AuthLayout title="Create your account">
      <SocialButtons action="sign-up" />
      <form
        noValidate
        onSubmit={submit}
        className="mt-6 space-y-6"
        aria-busy={loading}
      >
        <AuthError message={error} />
        <div className="space-y-1.5">
          <Label htmlFor="name">Full name</Label>
          <Input
            id="name"
            name="name"
            autoComplete="name"
            spellCheck={false}
            required
            maxLength={200}
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              validation.clearWhenValid("name", "name", e.target.value)
            }}
            onBlur={() => validation.check("name", "name", name)}
            aria-invalid={Boolean(validation.errors.name)}
            aria-describedby={validation.errors.name ? "name-error" : undefined}
            disabled={loading}
            placeholder="Enter your full name"
            className="h-10 shadow-xs"
          />
          <FieldError id="name-error" message={validation.errors.name} />
        </div>
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
            readOnly={Boolean(search.email)}
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
            validation.clearWhenValid("password", "password", value)
          }}
          onBlur={() => validation.check("password", "password", password)}
          error={validation.errors.password}
          disabled={loading}
          isNew
        />
        <Button
          type="submit"
          disabled={loading}
          className="h-10 w-full rounded-lg"
        >
          {loading ? "Creating account..." : "Sign up"}
        </Button>
      </form>
      <p className="mt-6 text-sm text-muted-foreground">
        Already have an account?{" "}
        <a
          href={authHref("/sign-in", {
            redirect: search.redirect ? destination : undefined,
            email: search.email,
          })}
          className="font-medium text-primary hover:underline dark:text-foreground dark:underline dark:decoration-primary dark:underline-offset-4"
        >
          Sign in
        </a>
      </p>
    </AuthLayout>
  )
}
