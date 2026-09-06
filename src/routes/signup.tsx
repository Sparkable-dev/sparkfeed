import { Link, createFileRoute, redirect } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import {
  ArrowRight,
  Check,
  ChevronLeft,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  User,
  X,
  Zap,
} from "lucide-react"
import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export const Route = createFileRoute("/signup")({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === "string" ? search.redirect : "",
    email: typeof search.email === "string" ? search.email : "",
  }),
  beforeLoad: async ({ search }) => {
    if (import.meta.env.VITE_DEMO_MODE === "true") throw redirect({ to: "/" })

    const { checkCanRegister } = await import("@/server/auth-setup")
    const { allowed, reason } = await checkCanRegister({
      data: { email: search.email || undefined },
    })
    if (!allowed) {
      throw redirect({ to: "/login", search: { info: reason } as any })
    }
  },
  component: SignupPage,
})

function SignupPage() {
  const { redirect: redirectTo, email: invitedEmail } = Route.useSearch()
  const verifyCallback = redirectTo
    ? `/verify-email?redirect=${encodeURIComponent(redirectTo)}`
    : "/verify-email"

  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [email, setEmail] = useState(invitedEmail)
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [verificationSent, setVerificationSent] = useState(false)
  const [sentToEmail, setSentToEmail] = useState("")

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()

    if (password.length < 8) {
      toast.error("Password must be at least 8 characters")
      return
    }

    if (password !== confirmPassword) {
      toast.error("Passwords do not match")
      return
    }

    setLoading(true)
    try {
      const result = await authClient.signUp.email({
        name: `${firstName} ${lastName}`.trim(),
        email,
        password,
        callbackURL: verifyCallback,
      })

      if (result.error) {
        toast.error(result.error.message || "Could not create account")
        return
      }

      setSentToEmail(email)
      setVerificationSent(true)
    } catch {
      toast.error("Something went wrong. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  if (verificationSent) {
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
            {/* Mail icon in purple circle */}
            <div className="mb-4 flex justify-center">
              <div className="rounded-full bg-purple-600/20 p-4">
                <Mail className="h-7 w-7 text-purple-400" />
              </div>
            </div>

            <CardTitle className="text-2xl font-bold text-white">
              Check your inbox!
            </CardTitle>
            <CardDescription className="text-zinc-400">
              We sent a verification link to
            </CardDescription>
            <p className="mt-1 text-sm font-semibold text-white">
              {sentToEmail}
            </p>
          </CardHeader>

          <CardContent className="flex flex-col gap-4 pt-2 pb-8">
            {/* Info box */}
            <div className="rounded-xl border border-purple-500/20 bg-purple-500/10 p-4">
              <p className="text-center text-sm leading-relaxed text-zinc-300">
                Click the link in the email to verify your account and get
                started with SparkFeed.
              </p>
            </div>

            {/* Resend button */}
            <ResendVerificationButton
              email={sentToEmail}
              callbackURL={verifyCallback}
            />

            {/* Back to login */}
            <div className="text-center">
              <Link
                to="/login"
                className="inline-flex items-center gap-1 text-sm text-zinc-500 transition-colors hover:text-zinc-300"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Back to Login
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-black p-4">
      {/* SparkFeed logo */}
      <div className="mb-5 flex items-center justify-center gap-2">
        <div className="rounded-xl bg-purple-600 p-2">
          <Zap className="h-5 w-5 text-white" fill="currentColor" />
        </div>
        <span className="text-lg font-bold text-white">SparkFeed</span>
      </div>

      <Card className="w-full max-w-md rounded-2xl border-zinc-800 bg-zinc-900">
        <CardHeader className="pb-2 text-center">
          <CardTitle className="text-2xl font-bold text-white">
            Create your account
          </CardTitle>
          <CardDescription className="text-zinc-400">
            Join our community of smart readers today
          </CardDescription>
        </CardHeader>

        <form onSubmit={handleSignup}>
          <CardContent className="flex flex-col gap-4 pt-2 pb-8">
            {/* First + Last Name in grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs tracking-wider text-zinc-500 uppercase">
                  First Name
                </Label>
                <div className="relative flex items-center rounded-xl border border-zinc-800 bg-zinc-950/50 transition-all focus-within:border-purple-500/40">
                  <User className="pointer-events-none absolute left-3.5 h-4 w-4 text-zinc-600" />
                  <Input
                    type="text"
                    required
                    placeholder="Jane"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    disabled={loading}
                    className="h-11 border-0 bg-transparent pl-10 text-white focus-visible:border-none focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs tracking-wider text-zinc-500 uppercase">
                  Last Name
                </Label>
                <div className="relative flex items-center rounded-xl border border-zinc-800 bg-zinc-950/50 transition-all focus-within:border-purple-500/40">
                  <User className="pointer-events-none absolute left-3.5 h-4 w-4 text-zinc-600" />
                  <Input
                    type="text"
                    required
                    placeholder="Doe"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    disabled={loading}
                    className="h-11 border-0 bg-transparent pl-10 text-white focus-visible:border-none focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                </div>
              </div>
            </div>

            {/* Email */}
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs tracking-wider text-zinc-500 uppercase">
                Email address
              </Label>
              <div className="relative flex items-center rounded-xl border border-zinc-800 bg-zinc-950/50 transition-all focus-within:border-purple-500/40">
                <Mail className="pointer-events-none absolute left-3.5 h-4 w-4 text-zinc-600" />
                <Input
                  type="email"
                  required
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading || Boolean(invitedEmail)}
                  className="h-11 border-0 bg-transparent pl-10 text-white focus-visible:border-none focus-visible:ring-0 focus-visible:ring-offset-0"
                />
              </div>
            </div>

            {/* Password */}
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs tracking-wider text-zinc-500 uppercase">
                Password
              </Label>
              <div className="relative flex items-center rounded-xl border border-zinc-800 bg-zinc-950/50 transition-all focus-within:border-purple-500/40">
                <Lock className="pointer-events-none absolute left-3.5 h-4 w-4 text-zinc-600" />
                <Input
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={8}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  className="h-11 border-0 bg-transparent pr-10 pl-10 text-white focus-visible:border-none focus-visible:ring-0 focus-visible:ring-offset-0"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute top-1/2 right-3 -translate-y-1/2 text-zinc-500 transition-colors hover:text-zinc-300"
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Confirm Password */}
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs tracking-wider text-zinc-500 uppercase">
                Confirm Password
              </Label>
              <div
                className={`relative flex items-center rounded-xl border transition-all duration-300 focus-within:ring-offset-0 ${
                  !confirmPassword
                    ? "border-zinc-800 bg-zinc-950/50 focus-within:border-purple-500/40"
                    : confirmPassword === password
                      ? "border-green-500 bg-green-950/10 focus-within:border-green-500"
                      : "border-red-500 bg-red-950/10 focus-within:border-red-500"
                }`}
              >
                <Lock
                  className={`pointer-events-none absolute left-3.5 h-4 w-4 transition-colors ${
                    !confirmPassword
                      ? "text-zinc-600"
                      : confirmPassword === password
                        ? "text-green-500/70"
                        : "text-red-500/70"
                  }`}
                />
                <Input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={loading}
                  className="h-11 border-0 bg-transparent pr-10 pl-10 text-white focus-visible:border-none focus-visible:ring-0 focus-visible:ring-offset-0"
                />
                {confirmPassword && (
                  <div className="absolute top-1/2 right-3 -translate-y-1/2">
                    {confirmPassword === password ? (
                      <div className="flex h-5 w-5 items-center justify-center rounded-full border border-green-500/50 bg-green-500/10">
                        <Check
                          className="h-3 w-3 text-green-500"
                          strokeWidth={3}
                        />
                      </div>
                    ) : (
                      <div className="flex h-5 w-5 items-center justify-center rounded-full border border-red-500/50 bg-red-500/10">
                        <X className="h-3 w-3 text-red-500" strokeWidth={3} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Submit Button */}
            <Button
              type="submit"
              disabled={loading}
              className="mt-1 h-11 w-full rounded-xl bg-purple-600 font-semibold text-white hover:bg-purple-700"
            >
              {loading ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating Account...
                </div>
              ) : (
                <div className="flex items-center justify-center gap-2">
                  Get Started
                  <ArrowRight className="h-4 w-4" />
                </div>
              )}
            </Button>

            {/* Footer */}
            <p className="mt-1 text-center text-sm text-zinc-500">
              Already have an account?{" "}
              <Link
                to="/login"
                className="font-semibold text-purple-400 transition-colors hover:text-purple-300"
              >
                Sign in
              </Link>
            </p>
          </CardContent>
        </form>
      </Card>
    </div>
  )
}

function ResendVerificationButton({
  email,
  callbackURL,
}: {
  email: string
  callbackURL: string
}) {
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
        callbackURL,
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
      variant="outline"
      className="w-full border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-white"
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
