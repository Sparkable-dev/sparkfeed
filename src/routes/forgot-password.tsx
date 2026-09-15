import { createFileRoute, redirect } from "@tanstack/react-router"
import { useState } from "react"
import type { FormEvent } from "react"
import { authClient } from "@/lib/auth-client"
import { AuthError, AuthLayout, FieldError } from "@/components/auth/auth-ui"
import { useAuthValidation } from "@/components/auth/use-auth-validation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export const Route = createFileRoute("/forgot-password")({
  beforeLoad: () => {
    if (import.meta.env.VITE_DEMO_MODE === "true") throw redirect({ to: "/" })
  },
  component: ForgotPasswordPage,
})
function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState("")
  const validation = useAuthValidation()
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (loading || !validation.validate([["email", "email", email]])) return
    setLoading(true)
    setError("")
    try {
      const result = await authClient.requestPasswordReset({
        email: email.trim(),
        redirectTo: "/reset-password",
      })
      if (result.error)
        throw new Error("Unable to send a reset link. Please try again.")
      setSent(true)
    } catch {
      setError("Unable to send a reset link. Please try again.")
    } finally {
      setLoading(false)
    }
  }
  return (
    <AuthLayout title={sent ? "Check your email" : "Forgot password?"}>
      {sent ? (
        <div className="mt-6 space-y-4">
          <p role="status" className="text-sm text-muted-foreground">
            If an account exists for{" "}
            <span className="font-medium break-all">{email}</span>, we’ve sent a
            password reset link. Check your inbox and spam folder.
          </p>
          <Button
            variant="outline"
            type="button"
            onClick={() => setSent(false)}
            className="w-full"
          >
            Try another email
          </Button>
        </div>
      ) : (
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
              className="h-10"
            />
            <FieldError id="email-error" message={validation.errors.email} />
          </div>
          <Button type="submit" disabled={loading} className="h-10 w-full">
            {loading ? "Sending..." : "Send reset link"}
          </Button>
        </form>
      )}
      <a
        href="/sign-in"
        className="mt-6 text-sm font-medium text-primary hover:underline dark:text-foreground dark:underline dark:decoration-primary dark:underline-offset-4"
      >
        Back to sign in
      </a>
    </AuthLayout>
  )
}
