import { createFileRoute, redirect } from "@tanstack/react-router"
import { useState } from "react"
import type { FormEvent } from "react"
import { authClient } from "@/lib/auth-client"
import { authSearch } from "@/lib/auth-redirect"
import { AuthError, AuthLayout, PasswordField } from "@/components/auth/auth-ui"
import { useAuthValidation } from "@/components/auth/use-auth-validation"
import { Button } from "@/components/ui/button"

export const Route = createFileRoute("/reset-password")({
  validateSearch: authSearch,
  beforeLoad: () => {
    if (import.meta.env.VITE_DEMO_MODE === "true") throw redirect({ to: "/" })
  },
  component: ResetPasswordPage,
})
function ResetPasswordPage() {
  const { token, error: linkError } = Route.useSearch()
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const validation = useAuthValidation()
  const invalid = !token || Boolean(linkError)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (
      loading ||
      invalid ||
      !validation.validate([["password", "password", password]])
    )
      return
    setLoading(true)
    setError("")
    try {
      const result = await authClient.resetPassword({
        newPassword: password,
        token,
      })
      if (result.error)
        throw new Error(
          result.error.message ||
            "Unable to reset your password. Request a new link."
        )
      window.location.replace("/sign-in?info=password-reset")
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to reset your password. Please try again."
      )
    } finally {
      setLoading(false)
    }
  }
  return (
    <AuthLayout title={invalid ? "Invalid reset link" : "Reset your password"}>
      {invalid ? (
        <p role="alert" className="mt-6 text-sm text-muted-foreground">
          This reset link is missing or expired. Request a new link to continue.
        </p>
      ) : (
        <form
          noValidate
          onSubmit={submit}
          className="mt-6 space-y-6"
          aria-busy={loading}
        >
          <AuthError message={error} />
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
          <Button type="submit" disabled={loading} className="h-10 w-full">
            {loading ? "Resetting password..." : "Reset password"}
          </Button>
        </form>
      )}
      <a
        href="/forgot-password"
        className="mt-6 text-sm font-medium text-primary hover:underline dark:text-foreground dark:underline dark:decoration-primary dark:underline-offset-4"
      >
        Request a new reset link
      </a>
      <a
        href="/sign-in"
        className="mt-3 text-sm text-muted-foreground hover:underline"
      >
        Back to sign in
      </a>
    </AuthLayout>
  )
}
