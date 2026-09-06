import { Link, createFileRoute, redirect } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import {
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  MailWarning,
  Zap,
} from "lucide-react"
import { safeLoginRedirect } from "@/lib/auth-redirect"
import { authClient } from "@/lib/auth-client"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export const Route = createFileRoute("/login")({
  beforeLoad: () => {
    if (import.meta.env.VITE_DEMO_MODE === "true") throw redirect({ to: "/" })
  },
  component: LoginPage,
})

function LoginPage() {
  // Use URL search params directly since route doesn't have validateSearch
  const searchParams =
    typeof window !== "undefined"
      ? new URL(window.location.href).searchParams
      : new URLSearchParams()
  const redirectTo = safeLoginRedirect(searchParams.get("redirect"), "/")
  const infoParam = searchParams.get("info")

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loginError, setLoginError] = useState(false)
  const [unverified, setUnverified] = useState(false)
  const [unverifiedEmail, setUnverifiedEmail] = useState("")

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setLoginError(false)
    try {
      const result = await authClient.signIn.email({
        email,
        password,
      })
      if (result.error) {
        setLoginError(true)
        const error = result.error
        if (
          error.code === "EMAIL_NOT_VERIFIED" ||
          error.message?.toLowerCase().includes("verify") ||
          error.message?.toLowerCase().includes("verified")
        ) {
          setUnverifiedEmail(email)
          setUnverified(true)
          return
        }
        toast.error(result.error.message || "Invalid credentials")
        return
      }
      toast.success("Welcome back!")
      window.location.href = redirectTo
    } catch {
      toast.error("Something went wrong. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  if (unverified) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-black p-4">
        {/* SparkFeed logo */}
        <div className="mb-6 flex items-center justify-center gap-2">
          <div className="rounded-xl bg-purple-600 p-2">
            <Zap className="h-5 w-5 text-white" fill="currentColor" />
          </div>
          <span className="text-lg font-bold text-white">SparkFeed</span>
        </div>

        <Card className="w-full max-w-md rounded-2xl border-zinc-800 bg-zinc-900">
          <CardHeader className="pb-2 text-center">
            <div className="mb-4 flex justify-center">
              <div className="rounded-full bg-amber-500/20 p-4">
                <MailWarning className="h-7 w-7 text-amber-400" />
              </div>
            </div>
            <CardTitle className="text-2xl font-bold text-white">
              Verify your email
            </CardTitle>
            <CardDescription className="text-zinc-400">
              You need to verify your email before signing in
            </CardDescription>
            <p className="mt-1 text-sm font-semibold text-white">
              {unverifiedEmail}
            </p>
          </CardHeader>

          <CardContent className="flex flex-col gap-4 pt-2 pb-8">
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4">
              <p className="text-center text-sm leading-relaxed text-zinc-300">
                Check your inbox for the verification email we sent when you
                signed up. Click the link to verify your account.
              </p>
            </div>

            <ResendVerificationButton email={unverifiedEmail} />

            <Button
              variant="outline"
              className="w-full border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-white"
              onClick={() => {
                setUnverified(false)
                setUnverifiedEmail("")
              }}
            >
              Back to Sign in
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="auth-page bg-[#050505]">
      {/* Background gradient orbs */}
      <div className="auth-orb auth-orb-1 opacity-20" />
      <div className="auth-orb auth-orb-2 opacity-10" />
      <div className="auth-orb auth-orb-3 opacity-15" />

      <div className="auth-container max-w-md">
        {/* Logo */}
        <div className="auth-logo mb-8">
          <div className="auth-logo-icon bg-purple-600 shadow-lg shadow-purple-600/20">
            <Zap className="auth-logo-svg text-white" />
          </div>
          <span className="auth-brand text-white">SparkFeed</span>
        </div>

        {/* Card */}
        <div className="auth-card border border-zinc-800 bg-zinc-900/50 backdrop-blur-xl">
          <div className="auth-card-header">
            <h1 className="auth-title text-white">Welcome back</h1>
            <p className="auth-subtitle text-zinc-400">
              Sign in to your account to continue
            </p>
          </div>

          {infoParam === "invite-only" && (
            <div className="mx-6 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
              <p className="text-center text-sm text-amber-300">
                This instance is invite-only. Contact your admin for an
                invitation.
              </p>
            </div>
          )}

          <form onSubmit={handleLogin} className="auth-form space-y-6">
            {/* Email */}
            <div className="auth-field">
              <label htmlFor="login-email" className="auth-label text-zinc-400">
                Email address
              </label>
              <div className="auth-input-wrapper border-zinc-800 bg-zinc-950/50 transition-all focus-within:border-purple-500/50">
                <Mail className="auth-input-icon text-zinc-600" />
                <input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="auth-input text-white placeholder:text-zinc-700"
                  disabled={loading}
                />
              </div>
            </div>

            {/* Password */}
            <div className="auth-field">
              <div className="mb-1.5 flex items-center justify-between">
                <label
                  htmlFor="login-password"
                  className="auth-label mb-0 text-zinc-400"
                >
                  Password
                </label>
                <Link
                  to="/forgot-password"
                  className={`text-[11px] font-bold tracking-wider uppercase transition-colors ${loginError ? "animate-pulse text-purple-400" : "text-zinc-500 hover:text-white"}`}
                >
                  Forgot password?
                </Link>
              </div>
              <div className="auth-input-wrapper border-zinc-800 bg-zinc-950/50 transition-all focus-within:border-purple-500/50">
                <Lock className="auth-input-icon text-zinc-600" />
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="auth-input text-white placeholder:text-zinc-700"
                  disabled={loading}
                />
                <button
                  type="button"
                  className="auth-eye-btn text-zinc-600 hover:text-zinc-400"
                  onClick={() => setShowPassword((v) => !v)}
                  tabIndex={-1}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              id="login-submit"
              type="submit"
              className="auth-btn-primary h-12 bg-purple-600 font-bold text-white shadow-lg shadow-purple-600/10 transition-all hover:bg-purple-700 active:scale-[0.98]"
              disabled={loading}
            >
              {loading ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Signing in…</span>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-2">
                  <span>Sign in</span>
                  <ArrowRight className="h-4 w-4" />
                </div>
              )}
            </button>
          </form>

          {loginError && (
            <div className="mt-4 animate-in rounded-xl border border-purple-500/20 bg-purple-500/10 p-3 text-center text-[11px] font-medium text-purple-400 duration-300 slide-in-from-top-2">
              Trouble signing in? Try{" "}
              <Link
                to="/forgot-password"
                title={email}
                className="font-bold underline"
              >
                resetting your password
              </Link>
              .
            </div>
          )}

          <div className="auth-footer mt-8 border-t border-zinc-800/50 pt-6">
            <span className="auth-footer-text text-zinc-500">
              Don't have an account?
            </span>
            {/* The redirect has to survive the hop to signup: most people
                  taking a "sign in, it's free" CTA from a share link do not have
                  an account yet, and losing it here drops them on / with no idea
                  what they were doing. */}
            <a
              href={
                redirectTo && redirectTo !== "/"
                  ? `/signup?redirect=${encodeURIComponent(redirectTo)}`
                  : "/signup"
              }
              className="auth-footer-link ml-2 font-semibold text-purple-400 hover:text-purple-300"
            >
              Create one
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

function ResendVerificationButton({ email }: { email: string }) {
  const [resending, setResending] = useState(false)
  const [resent, setResent] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown > 0) {
      const timer = setTimeout(() => setCooldown((c) => c - 1), 1000)
      return () => clearTimeout(timer)
    }
  }, [cooldown])

  const handleResend = async () => {
    setResending(true)
    try {
      await authClient.sendVerificationEmail({
        email,
        callbackURL: "/verify-email",
      })
      setResent(true)
      setCooldown(60)
      setTimeout(() => setResent(false), 3000)
    } catch (err) {
      toast.error("Failed to resend email")
    } finally {
      setResending(false)
    }
  }

  return (
    <Button
      className="w-full rounded-xl bg-purple-600 font-semibold text-white hover:bg-purple-700"
      onClick={handleResend}
      disabled={resending || cooldown > 0}
    >
      {resending ? (
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Sending...
        </div>
      ) : resent ? (
        <div className="flex items-center gap-2">
          <Check className="h-4 w-4 text-green-400" />
          Sent!
        </div>
      ) : cooldown > 0 ? (
        `Resend in ${cooldown}s`
      ) : (
        "Resend verification email"
      )}
    </Button>
  )
}
