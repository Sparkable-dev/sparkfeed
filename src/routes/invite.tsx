import {
  Link,
  createFileRoute,
  redirect,
  useNavigate,
} from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { ChevronLeft, Loader2, Mail, UserPlus, X, Zap } from "lucide-react"
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
import { getInvitationSignupHint } from "@/server/email-actions"

export const Route = createFileRoute("/invite")({
  beforeLoad: () => {
    if (import.meta.env.VITE_DEMO_MODE === "true") throw redirect({ to: "/" })
  },
  validateSearch: (search: Record<string, unknown>) => {
    return {
      token: (search.token as string) || "",
      email: (search.email as string) || "",
    }
  },
  component: InvitePage,
})

function InvitePage() {
  const { token, email: invitedEmail } = Route.useSearch()
  const navigate = useNavigate()
  const [email, setEmail] = useState(invitedEmail)
  const [userExists, setUserExists] = useState(false)
  const [isVerifying, setIsVerifying] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function checkToken() {
      if (!token || !invitedEmail) {
        setError("Missing invitation token.")
        setIsVerifying(false)
        return
      }
      try {
        const invite = await getInvitationSignupHint({
          data: { invitationId: token, email: invitedEmail },
        })
        setEmail(invite.email)
        setUserExists(invite.userExists)
      } catch (err: any) {
        setError(err.message || "Invalid invitation link.")
      } finally {
        setIsVerifying(false)
      }
    }
    checkToken()
  }, [invitedEmail, token])

  const { data: session } = authClient.useSession()
  const isLoggedIn = !!session
  const userEmail = session?.user?.email

  // Existing users sign in. New invitees create the account that the closed
  // registration policy permits for this invitation email.
  useEffect(() => {
    if (!isVerifying && !isLoggedIn && !error) {
      const redirectTo = `/invite?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`
      if (userExists) {
        navigate({ to: "/sign-in", search: { redirect: redirectTo } })
      } else {
        navigate({
          to: "/sign-up",
          search: { redirect: redirectTo, email },
        })
      }
    }
  }, [email, error, isLoggedIn, isVerifying, navigate, token, userExists])

  const handleAccept = async () => {
    setIsSubmitting(true)
    try {
      if (session && session.user.email !== email) {
        throw new Error(
          "You must be logged in with the same email the invitation was sent to."
        )
      }

      const { error: acceptError } =
        await authClient.organization.acceptInvitation({
          invitationId: token,
        })
      if (acceptError) throw acceptError

      toast.success("Joined workspace successfully!")

      // Use window.location to force a full state refresh
      window.location.href = "/"
    } catch (err: any) {
      toast.error(err.message || "Failed to join workspace")
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isVerifying) {
    return (
      <div className="flex h-screen items-center justify-center bg-card dark:bg-black">
        <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-card dark:bg-black p-4">
        {/* SparkFeed logo above card */}
        <div className="mb-6 flex items-center justify-center gap-2">
          <div className="rounded-xl bg-purple-600 p-2">
            <Zap className="h-5 w-5 text-foreground dark:text-white" fill="currentColor" />
          </div>
          <span className="text-lg font-bold text-foreground dark:text-white">SparkFeed</span>
        </div>

        <Card className="flex w-full max-w-md flex-col gap-4 rounded-2xl border-border dark:border-zinc-800 bg-card dark:bg-zinc-900 p-8 text-center">
          <div className="mb-2 flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-500/10">
              <X className="h-8 w-8 text-red-500" />
            </div>
          </div>
          <h1 className="mb-2 text-2xl font-bold text-foreground dark:text-white">
            Invitation Error
          </h1>
          <p className="mb-6 text-muted-foreground dark:text-zinc-400">{error}</p>
          <Button
            onClick={() => navigate({ to: "/sign-in" })}
            className="w-full bg-accent dark:bg-zinc-800 text-foreground dark:text-white hover:bg-accent dark:hover:bg-zinc-700"
          >
            Back to Login
          </Button>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-card dark:bg-black p-4">
      {/* SparkFeed logo above card */}
      <div className="mb-6 flex items-center justify-center gap-2">
        <div className="rounded-xl bg-purple-600 p-2">
          <Zap className="h-5 w-5 text-foreground dark:text-white" fill="currentColor" />
        </div>
        <span className="text-lg font-bold text-foreground dark:text-white">SparkFeed</span>
      </div>

      {/* Card */}
      <Card className="w-full max-w-md rounded-2xl border-border dark:border-zinc-800 bg-card dark:bg-zinc-900">
        <CardHeader className="pb-2 text-center">
          {/* Icon */}
          <div className="mb-4 flex justify-center">
            <div className="rounded-2xl bg-purple-600/20 p-4">
              <UserPlus className="h-7 w-7 text-purple-700 dark:text-purple-400" />
            </div>
          </div>

          <CardTitle className="text-2xl font-bold text-foreground dark:text-white">
            Join Workspace
          </CardTitle>
          <CardDescription className="text-muted-foreground dark:text-zinc-400">
            Accept the invitation to start collaborating
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-5 pt-2 pb-10">
          {/* Email field */}
          <div className="flex flex-col gap-2">
            <Label className="text-xs tracking-wider text-muted-foreground dark:text-zinc-500 uppercase">
              Email
            </Label>
            <div className="relative flex items-center rounded-xl border border-border dark:border-zinc-800 bg-card dark:bg-zinc-950/50 opacity-60">
              <Mail className="pointer-events-none absolute left-3.5 h-4 w-4 text-muted-foreground dark:text-zinc-600" />
              <Input
                type="email"
                disabled
                value={email}
                className="h-11 cursor-not-allowed border-0 bg-transparent pl-10 text-muted-foreground dark:text-zinc-400 focus-visible:border-none focus-visible:ring-0 focus-visible:ring-offset-0"
              />
            </div>
          </div>

          {/* Logged in info box */}
          {isLoggedIn && (
            <div className="rounded-xl border border-purple-500/20 bg-purple-500/10 p-4">
              <p className="text-sm leading-relaxed text-foreground dark:text-zinc-300">
                You are logged in as{" "}
                <span className="font-semibold text-foreground dark:text-white">{userEmail}</span>.
                Click below to join the workspace with this account.
              </p>
            </div>
          )}

          {/* Accept button */}
          <Button
            onClick={handleAccept}
            disabled={isSubmitting}
            className="mt-2 w-full rounded-xl bg-purple-600 py-3 font-semibold text-white hover:bg-purple-700"
          >
            {isSubmitting ? (
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            ) : null}
            Accept Invitation
          </Button>
        </CardContent>
      </Card>

      {/* Back to Login */}
      <div className="mt-5 text-center">
        <Link
          to="/sign-in"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground dark:text-zinc-500 transition-colors hover:text-foreground dark:hover:text-zinc-300"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Back to Login
        </Link>
      </div>
    </div>
  )
}
