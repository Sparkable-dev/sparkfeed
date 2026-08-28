import { Link, createFileRoute, redirect, useNavigate } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import {
  Check, ChevronLeft, Eye,
  EyeOff, Loader2, Lock, X, Zap
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
  CardTitle
} from "@/components/ui/card"

export const Route = createFileRoute("/reset-password")({
  beforeLoad: () => {
    if (import.meta.env.VITE_DEMO_MODE === "true") throw redirect({ to: "/" })
  },
  validateSearch: (search: Record<string, unknown>) => {
    return {
      token: (search.token as string) || "",
    }
  },
  component: ResetPasswordPage,
})

function ResetPasswordPage() {
  const { token } = Route.useSearch()
  const navigate = useNavigate()
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) {
      setError("Missing reset token. Please request a new link.")
    }
  }, [token])

  const getStrength = (pass: string) => {
    let score = 0
    if (pass.length >= 8) score++
    if (/[A-Z]/.test(pass)) score++
    if (/[0-9]/.test(pass)) score++
    if (/[^A-Za-z0-9]/.test(pass)) score++
    return score
  }

  const requirements = [
    { label: "At least 8 characters", met: password.length >= 8 },
    { label: "One uppercase letter", met: /[A-Z]/.test(password) },
    { label: "One number", met: /[0-9]/.test(password) },
    { label: "One special character", met: /[^A-Za-z0-9]/.test(password) },
  ]

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (password.length < 8) {
      toast.error("Password must be at least 8 characters")
      return
    }

    if (password !== confirmPassword) {
      toast.error("Passwords do not match")
      return
    }

    setIsSubmitting(true)
    try {
      const { error: authError } = await authClient.resetPassword({
        newPassword: password,
        token,
      })

      if (authError) throw authError

      toast.success("Password reset successfully! You can now log in.")
      navigate({ to: "/login" })
    } catch (err: any) {
      toast.error(err.message || "Failed to reset password. The link may have expired.")
    } finally {
      setIsSubmitting(false)
    }
  }

  if (error) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center p-4">
        {/* SparkFeed logo above card */}
        <div className="flex items-center justify-center gap-2 mb-6">
          <div className="bg-purple-600 rounded-xl p-2">
            <Zap className="h-5 w-5 text-white" fill="currentColor" />
          </div>
          <span className="text-white font-bold text-lg">SparkFeed</span>
        </div>

        <Card className="w-full max-w-md bg-zinc-900 border-zinc-800 rounded-2xl text-center p-8 flex flex-col gap-4">
          <div className="flex justify-center mb-2">
            <div className="h-16 w-16 rounded-2xl bg-red-500/10 flex items-center justify-center">
              <X className="h-8 w-8 text-red-500" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Invalid Link</h1>
          <p className="text-zinc-400 mb-6">{error}</p>
          <Button
            onClick={() => navigate({ to: "/forgot-password" })}
            className="w-full bg-zinc-800 hover:bg-zinc-700 text-white"
          >
            Request New Link
          </Button>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center p-4">
      {/* SparkFeed logo above card */}
      <div className="flex items-center justify-center gap-2 mb-6">
        <div className="bg-purple-600 rounded-xl p-2">
          <Zap className="h-5 w-5 text-white" fill="currentColor" />
        </div>
        <span className="text-white font-bold text-lg">SparkFeed</span>
      </div>

      {/* Card */}
      <Card className="w-full max-w-md bg-zinc-900 border-zinc-800 rounded-2xl">
        <CardHeader className="text-center pb-2">
          <CardTitle className="text-2xl font-bold text-white">Reset Password</CardTitle>
          <CardDescription className="text-zinc-400">
            Enter your new secure password below
          </CardDescription>
        </CardHeader>

        <form onSubmit={handleSubmit}>
          <CardContent className="flex flex-col gap-6 pt-2 pb-10">
            {/* New Password */}
            <div className="flex flex-col gap-2">
              <Label className="text-xs text-zinc-500 tracking-wider uppercase">
                New Password
              </Label>
              <div className="relative flex items-center border border-zinc-800 bg-zinc-950/50 rounded-xl focus-within:border-purple-500/50 transition-all">
                <Lock className="absolute left-3.5 h-4 w-4 text-zinc-600 pointer-events-none" />
                <Input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-transparent border-0 text-white pl-10 pr-10 h-11 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-none"
                  required
                  disabled={isSubmitting}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>

              {/* Strength bar and requirements layout */}
              {password && (
                <div className="flex flex-col gap-1.5 mt-2">
                  <div className="flex gap-1.5">
                    {[1, 2, 3, 4].map((i) => {
                      const strength = getStrength(password)
                      const colors = [
                        "",
                        "bg-red-500",
                        "bg-yellow-500",
                        "bg-blue-500",
                        "bg-green-500",
                      ]
                      return (
                        <div
                          key={i}
                          className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
                            i <= strength ? colors[strength] : "bg-zinc-700"
                          }`}
                        />
                      )
                    })}
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col gap-1">
                      {requirements.map((req) => (
                        <div key={req.label} className="flex items-center gap-2">
                          {req.met ? (
                            <Check className="h-4 w-4 text-green-400 shrink-0" />
                          ) : (
                            <X className="h-4 w-4 text-zinc-600 shrink-0" />
                          )}
                          <span
                            className={`text-sm ${
                              req.met ? "text-green-400" : "text-zinc-500"
                            }`}
                          >
                            {req.label}
                          </span>
                        </div>
                      ))}
                    </div>
                    <span
                      className={`text-sm font-medium self-start ${
                        [
                          "",
                          "text-red-400",
                          "text-yellow-400",
                          "text-blue-400",
                          "text-green-400",
                        ][getStrength(password)]
                      }`}
                    >
                      {[
                        "",
                        "Weak",
                        "Fair",
                        "Good",
                        "Strong",
                      ][getStrength(password)]}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Confirm Password */}
            <div className="flex flex-col gap-2">
              <Label className="text-xs text-zinc-500 tracking-wider uppercase">
                Confirm Password
              </Label>
              <div className={`relative flex items-center border rounded-xl transition-all duration-300 focus-within:ring-offset-0 ${
                !confirmPassword
                  ? "border-zinc-800 bg-zinc-950/50 focus-within:border-purple-500/50"
                  : confirmPassword === password
                    ? "border-green-500 bg-green-950/10 focus-within:border-green-500"
                    : "border-red-500 bg-red-950/10 focus-within:border-red-500"
              }`}>
                <Lock className={`absolute left-3.5 h-4 w-4 pointer-events-none transition-colors ${
                  !confirmPassword ? "text-zinc-600" : confirmPassword === password ? "text-green-500/70" : "text-red-500/70"
                }`} />
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="bg-transparent border-0 text-white pl-10 pr-10 h-11 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-none"
                  required
                  disabled={isSubmitting}
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center">
                  {confirmPassword && (
                    confirmPassword === password ? (
                      <Check className="h-4 w-4 text-green-400" />
                    ) : (
                      <X className="h-4 w-4 text-red-400" />
                    )
                  )}
                </div>
              </div>
            </div>

            {/* Submit Button */}
            <Button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 rounded-xl mt-4"
            >
              {isSubmitting ? (
                <div className="flex items-center gap-2 justify-center">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Resetting Password...</span>
                </div>
              ) : (
                "Reset Password"
              )}
            </Button>
          </CardContent>
        </form>
      </Card>

      {/* Back to Login */}
      <div className="mt-5 text-center">
        <Link
          to="/login"
          className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors inline-flex items-center gap-1"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Back to Login
        </Link>
      </div>
    </div>
  )
}
