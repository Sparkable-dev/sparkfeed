import { useEffect, useState } from "react"
import { KeyRound, Loader2, LogOut, Monitor } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { authClient } from "@/lib/auth-client"
import { DEMO_MODE } from "@/lib/demo"
import { requestPasswordReset } from "@/server/email-actions"

interface SecuritySettingsProps {
  session: any
}

interface AccountSession {
  id: string
  token: string
  ipAddress?: string | null
  userAgent?: string | null
  updatedAt: Date | string
}

function deviceLabel(userAgent?: string | null) {
  if (!userAgent) return "Unknown device"

  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\//.test(userAgent)
      ? "Firefox"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : "Browser"
  const device = /iPhone|iPad/.test(userAgent)
    ? "iPhone or iPad"
    : /Android/.test(userAgent)
      ? "Android"
      : /Windows/.test(userAgent)
        ? "Windows"
        : /Mac OS X|Macintosh/.test(userAgent)
          ? "Mac"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "device"

  return `${browser} on ${device}`
}

function lastActiveLabel(value: Date | string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Last active recently"
  return `Last active ${new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)}`
}

export function SecuritySettings({ session }: SecuritySettingsProps) {
  const user = session?.user
  const currentSessionToken = session?.session?.token
  const [isRequestingReset, setIsRequestingReset] = useState(false)
  const [sessions, setSessions] = useState<Array<AccountSession>>([])
  const [isLoadingSessions, setIsLoadingSessions] = useState(true)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [revokingToken, setRevokingToken] = useState<string | null>(null)

  useEffect(() => {
    if (DEMO_MODE) {
      setIsLoadingSessions(false)
      return
    }

    let cancelled = false

    authClient
      .listSessions()
      .then((result) => {
        if (cancelled) return
        if (result.error) throw new Error(result.error.message)
        setSessions(result.data || [])
        setSessionError(null)
      })
      .catch(() => {
        if (!cancelled)
          setSessionError("We couldn't load your signed-in devices.")
      })
      .finally(() => {
        if (!cancelled) setIsLoadingSessions(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const handleRequestReset = async () => {
    if (!user?.email) return
    setIsRequestingReset(true)
    try {
      await requestPasswordReset({ data: user.email })
      toast.success("Password reset email sent")
    } catch {
      toast.error("We couldn't send the reset email.")
    } finally {
      setIsRequestingReset(false)
    }
  }

  const handleRevoke = async (token: string) => {
    setRevokingToken(token)
    try {
      const result = await authClient.revokeSession({ token })
      if (result.error) throw new Error(result.error.message)
      setSessions((current) =>
        current.filter((accountSession) => accountSession.token !== token)
      )
      toast.success("Device signed out")
    } catch {
      toast.error("We couldn't sign out that device.")
    } finally {
      setRevokingToken(null)
    }
  }

  return (
    <div className="animate-in space-y-7 duration-300 fade-in">
      <h1 className="sr-only">Security</h1>

      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="flex flex-col gap-4 border-b px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
              <KeyRound className="size-4" />
            </div>
            <div>
              <p className="text-sm font-medium">Password</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Send a reset link to {user?.email}.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleRequestReset()}
            disabled={isRequestingReset || DEMO_MODE}
            className="w-full sm:w-auto"
          >
            {isRequestingReset && <Loader2 className="size-4 animate-spin" />}
            Send reset link
          </Button>
        </div>

        <div className="px-5 py-5 sm:px-6">
          <div className="mb-4 flex items-center gap-2">
            <Monitor className="size-4 text-muted-foreground" />
            <p className="text-sm font-medium">Signed-in devices</p>
          </div>
          {isLoadingSessions ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading devices
            </div>
          ) : sessionError ? (
            <p className="rounded-lg bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {sessionError}
            </p>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No signed-in devices were found.
            </p>
          ) : (
            <div className="space-y-2">
              {sessions.map((accountSession) => {
                const isCurrent = accountSession.token === currentSessionToken
                return (
                  <div
                    key={accountSession.id}
                    className="flex flex-col gap-3 rounded-lg border bg-muted/15 p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium">
                          {deviceLabel(accountSession.userAgent)}
                        </p>
                        {isCurrent && (
                          <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                            Current
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {[
                          accountSession.ipAddress,
                          lastActiveLabel(accountSession.updatedAt),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    {!isCurrent && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleRevoke(accountSession.token)}
                        disabled={revokingToken === accountSession.token}
                        className="w-full text-muted-foreground hover:text-destructive sm:w-auto"
                      >
                        {revokingToken === accountSession.token ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <LogOut className="size-4" />
                        )}
                        Sign out
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
