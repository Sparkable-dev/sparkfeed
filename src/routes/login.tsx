import { Link, createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Check, Eye, EyeOff, Loader2, Lock, Mail, MailWarning, Zap } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getIsPlatformAdminSurface } from "@/server/admin/route-state";

export const Route = createFileRoute("/login")({
  beforeLoad: async () => {
    if (import.meta.env.VITE_DEMO_MODE === "true") throw redirect({ to: "/" })
    return { adminSurface: await getIsPlatformAdminSurface() }
  },
  component: LoginPage,
});

function LoginPage() {
  const { adminSurface } = Route.useRouteContext()

  // Use URL search params directly since route doesn't have validateSearch
  const searchParams = typeof window !== 'undefined' ? new URL(window.location.href).searchParams : new URLSearchParams();
  const redirectTo = searchParams.get("redirect") || "/";
  const infoParam = searchParams.get("info");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loginError, setLoginError] = useState(false);
  const [unverified, setUnverified] = useState(false);
  const [unverifiedEmail, setUnverifiedEmail] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setLoginError(false);
    try {
      const result = await authClient.signIn.email({
        email,
        password,
      });
      if (result.error) {
        setLoginError(true);
        const error = result.error;
        if (error.code === "EMAIL_NOT_VERIFIED" ||
          error.message?.toLowerCase().includes("verify") ||
          error.message?.toLowerCase().includes("verified")) {
          setUnverifiedEmail(email)
          setUnverified(true)
          return
        }
        toast.error(result.error.message || "Invalid credentials");
        return;
      }
      if (
        result.data &&
        "twoFactorRedirect" in result.data &&
        result.data.twoFactorRedirect
      ) {
        return
      }
      toast.success("Welcome back!");
      window.location.href = redirectTo;
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (unverified) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center p-4">
        {/* SparkFeed logo */}
        <div className="flex items-center justify-center gap-2 mb-6">
          <div className="bg-purple-600 rounded-xl p-2">
            <Zap className="h-5 w-5 text-white" fill="currentColor" />
          </div>
          <span className="text-white font-bold text-lg">SparkFeed</span>
        </div>

        <Card className="w-full max-w-md bg-zinc-900 border-zinc-800 rounded-2xl">
          <CardHeader className="text-center pb-2">
            <div className="flex justify-center mb-4">
              <div className="bg-amber-500/20 rounded-full p-4">
                <MailWarning className="h-7 w-7 text-amber-400" />
              </div>
            </div>
            <CardTitle className="text-2xl font-bold text-white">
              Verify your email
            </CardTitle>
            <CardDescription className="text-zinc-400">
              You need to verify your email before signing in
            </CardDescription>
            <p className="text-white font-semibold text-sm mt-1">
              {unverifiedEmail}
            </p>
          </CardHeader>

          <CardContent className="flex flex-col gap-4 pt-2 pb-8">
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4">
              <p className="text-sm text-zinc-300 leading-relaxed text-center">
                Check your inbox for the verification email we sent when you signed up. Click the link to verify your account.
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
        <div className="auth-card bg-zinc-900/50 border border-zinc-800 backdrop-blur-xl">
          <div className="auth-card-header">
            <h1 className="auth-title text-white">Welcome back</h1>
            <p className="auth-subtitle text-zinc-400">Sign in to your account to continue</p>
          </div>

          {infoParam === "invite-only" && (
            <div className="mx-6 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
              <p className="text-sm text-amber-300 text-center">
                This instance is invite-only. Contact your admin for an invitation.
              </p>
            </div>
          )}

          <form onSubmit={handleLogin} className="auth-form space-y-6">
            {/* Email */}
            <div className="auth-field">
              <label htmlFor="login-email" className="auth-label text-zinc-400">
                Email address
              </label>
              <div className="auth-input-wrapper border-zinc-800 bg-zinc-950/50 focus-within:border-purple-500/50 transition-all">
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
              <div className="flex justify-between items-center mb-1.5">
                <label htmlFor="login-password" className="auth-label text-zinc-400 mb-0">
                  Password
                </label>
                <Link
                  to="/forgot-password"
                  className={`text-[11px] font-bold uppercase tracking-wider transition-colors ${loginError ? 'text-purple-400 animate-pulse' : 'text-zinc-500 hover:text-white'}`}
                >
                  Forgot password?
                </Link>
              </div>
              <div className="auth-input-wrapper border-zinc-800 bg-zinc-950/50 focus-within:border-purple-500/50 transition-all">
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
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              id="login-submit"
              type="submit"
              className="auth-btn-primary bg-purple-600 hover:bg-purple-700 text-white font-bold h-12 shadow-lg shadow-purple-600/10 transition-all active:scale-[0.98]"
              disabled={loading}
            >
              {loading ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Signing in…</span>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-2">
                  <span>Sign in</span>
                  <ArrowRight className="w-4 h-4" />
                </div>
              )}
            </button>
          </form>

          {loginError && (
            <div className="mt-4 p-3 bg-purple-500/10 border border-purple-500/20 rounded-xl text-[11px] text-purple-400 text-center font-medium animate-in slide-in-from-top-2 duration-300">
              Trouble signing in? Try <Link to="/forgot-password" title={email} className="underline font-bold">resetting your password</Link>.
            </div>
          )}

          {!adminSurface && (
            <div className="auth-footer mt-8 pt-6 border-t border-zinc-800/50">
              <span className="auth-footer-text text-zinc-500">Don't have an account?</span>
              {/* The redirect has to survive the hop to signup: most people
                  taking a "sign in, it's free" CTA from a share link do not have
                  an account yet, and losing it here drops them on / with no idea
                  what they were doing. */}
              <a
                href={redirectTo && redirectTo !== "/" ? `/signup?redirect=${encodeURIComponent(redirectTo)}` : "/signup"}
                className="auth-footer-link text-purple-400 hover:text-purple-300 font-semibold ml-2"
              >
                Create one
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ResendVerificationButton({
  email
}: { email: string }) {
  const [resending, setResending] = useState(false)
  const [resent, setResent] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown > 0) {
      const timer = setTimeout(() =>
        setCooldown(c => c - 1), 1000)
      return () => clearTimeout(timer)
    }
  }, [cooldown])

  const handleResend = async () => {
    setResending(true)
    try {
      await authClient.sendVerificationEmail({
        email,
        callbackURL: "/verify-email"
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
      className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-xl"
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
