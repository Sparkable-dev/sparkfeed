import {
  Link,
  createFileRoute,
  redirect,
  useNavigate,
} from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { CheckCircle2, ChevronLeft, Loader2, XCircle, Zap } from "lucide-react"
import { authClient } from "@/lib/auth-client"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export const Route = createFileRoute("/verify-email")({
  beforeLoad: () => {
    if (import.meta.env.VITE_DEMO_MODE === "true") throw redirect({ to: "/" })
  },
  component: VerifyEmailPage,
})

function VerifyEmailPage() {
  const navigate = useNavigate()
  const [status, setStatus] = useState<"loading" | "success" | "error">(
    "loading"
  )

  // Last leg of the redirect chain that starts at a share link's "sign in"
  // button: /sprk → /login → /signup → email → here → /login → /sprk.
  const redirectTo =
    (typeof window !== "undefined"
      ? new URL(window.location.href).searchParams.get("redirect")
      : null) || ""
  const [errorMessage, setErrorMessage] = useState("")

  useEffect(() => {
    const verify = async () => {
      const token =
        new URLSearchParams(window.location.search).get("token") || ""

      // If this token was already verified in this browser, show success immediately
      if (token && localStorage.getItem(`verified_token_${token}`) === "true") {
        setStatus("success")
        return
      }

      try {
        const { error } = await authClient.verifyEmail({
          query: {
            token,
          },
        })
        if (error) {
          setStatus("error")
          setErrorMessage(
            error.message || "Verification failed. The link may have expired."
          )
          return
        }

        if (token) {
          localStorage.setItem(`verified_token_${token}`, "true")
        }
        setStatus("success")
      } catch (err: any) {
        setStatus("error")
        setErrorMessage(
          err.message || "Verification failed. The link may have expired."
        )
      }
    }
    verify()
  }, [navigate])

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
          {/* Loading state icon */}
          {status === "loading" && (
            <div className="mb-4 flex justify-center">
              <div className="rounded-full bg-purple-600/20 p-4">
                <Loader2 className="h-7 w-7 animate-spin text-purple-400" />
              </div>
            </div>
          )}

          {/* Success state icon */}
          {status === "success" && (
            <div className="mb-4 flex justify-center">
              <div className="rounded-full bg-green-600/20 p-4">
                <CheckCircle2 className="h-7 w-7 text-green-400" />
              </div>
            </div>
          )}

          {/* Error state icon */}
          {status === "error" && (
            <div className="mb-4 flex justify-center">
              <div className="rounded-full bg-red-600/20 p-4">
                <XCircle className="h-7 w-7 text-red-400" />
              </div>
            </div>
          )}

          <CardTitle className="text-2xl font-bold text-white">
            {status === "loading" && "Verifying your email..."}
            {status === "success" && "Email verified!"}
            {status === "error" && "Verification failed"}
          </CardTitle>

          <CardDescription className="text-zinc-400">
            {status === "loading" &&
              "Please wait while we verify your email address."}
            {status === "success" && "Your account is now active and ready."}
            {status === "error" && errorMessage}
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-4 pt-2 pb-8">
          {/* Success state */}
          {status === "success" && (
            <>
              <div className="rounded-xl border border-green-500/20 bg-green-500/10 p-4">
                <p className="text-center text-sm leading-relaxed text-zinc-300">
                  Your email has been verified successfully! You can now log in
                  to SparkFeed.
                </p>
              </div>
              <Button
                className="w-full rounded-xl bg-purple-600 font-semibold text-white hover:bg-purple-700"
                onClick={() => {
                  if (redirectTo) {
                    window.location.href = `/login?redirect=${encodeURIComponent(redirectTo)}`
                  } else {
                    navigate({ to: "/login" })
                  }
                }}
              >
                Go to Login
              </Button>
            </>
          )}

          {/* Error state */}
          {status === "error" && (
            <>
              <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4">
                <p className="text-center text-sm leading-relaxed text-zinc-300">
                  The verification link may have expired or already been used.
                  Please request a new one.
                </p>
              </div>
              <Button
                className="w-full rounded-xl bg-purple-600 font-semibold text-white hover:bg-purple-700"
                onClick={() =>
                  navigate({
                    to: "/signup",
                    search: { redirect: "", email: "" },
                  })
                }
              >
                Back to Sign up
              </Button>
              <div className="text-center">
                <Link
                  to="/login"
                  className="inline-flex items-center gap-1 text-sm text-zinc-500 transition-colors hover:text-zinc-300"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Back to Login
                </Link>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
