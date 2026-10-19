import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link2, Loader2 } from "lucide-react"
import type { SocialProvider } from "@/lib/social-auth"
import { Button } from "@/components/ui/button"
import { authClient } from "@/lib/auth-client"
import { DEMO_MODE } from "@/lib/demo"
import {
  socialAuthError,
  socialProviderLabels,
  socialProviders,
} from "@/lib/social-auth"
import { useSocialProviders } from "@/hooks/use-social-providers"

const callbackURL = "/settings?tab=security"

export function ConnectedAccounts({
  userId,
  oauthError,
}: {
  userId?: string
  oauthError?: string
}) {
  const queryClient = useQueryClient()
  const providers = useSocialProviders()
  const accountsKey = ["connected-accounts", userId]
  const accounts = useQuery({
    queryKey: accountsKey,
    queryFn: async () => {
      const result = await authClient.listAccounts()
      if (result.error)
        throw new Error("We couldn't load your sign-in methods.")
      return result.data || []
    },
    enabled: Boolean(userId) && !DEMO_MODE,
  })
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState(socialAuthError(oauthError))
  const [notice, setNotice] = useState("")

  async function connect(provider: SocialProvider) {
    if (pending) return
    setPending(provider)
    setError("")
    setNotice("")
    try {
      const result = await authClient.linkSocial({
        provider,
        callbackURL,
        errorCallbackURL: callbackURL,
      })
      if (result.error)
        setError(socialAuthError(result.error.code || "unknown"))
    } catch {
      setError("We couldn't connect this provider. Please try again.")
    } finally {
      setPending(null)
    }
  }

  async function disconnect(id: string) {
    if (pending) return
    setPending(id)
    setError("")
    setNotice("")
    try {
      const result = await authClient.unlinkAccount({ accountId: id })
      if (result.error) {
        setError(
          result.error.code === "FAILED_TO_UNLINK_LAST_ACCOUNT"
            ? "Keep at least one sign-in method connected."
            : socialAuthError(result.error.code || "unknown")
        )
      } else {
        await queryClient.invalidateQueries({ queryKey: accountsKey })
        setNotice("Sign-in method disconnected.")
      }
    } catch {
      setError("We couldn't disconnect this provider. Please try again.")
    } finally {
      setPending(null)
    }
  }

  const message =
    error ||
    (accounts.isError
      ? "We couldn't load your sign-in methods. Please refresh and try again."
      : "") ||
    (providers.isError
      ? "We couldn't load the available providers. Please refresh and try again."
      : "")
  const methods = accounts.data || []
  const loading = !DEMO_MODE && (accounts.isPending || providers.isPending)

  const visibleProviders = socialProviders.filter(
    (provider) =>
      providers.data?.includes(provider) ||
      methods.some((method) => method.providerId === provider)
  )
  if (!loading && !message && !visibleProviders.length) return null

  return (
    <section
      className="overflow-hidden rounded-xl border bg-card"
      aria-labelledby="connected-accounts-title"
    >
      <div className="flex gap-3 border-b px-5 py-5 sm:px-6">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Link2 className="size-4" />
        </div>
        <div>
          <h2 id="connected-accounts-title" className="text-sm font-medium">
            Sign-in methods
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Connect an account to sign in to Sparkfeed. Your workspace and data
            stay together, even if the provider uses a different email.
          </p>
        </div>
      </div>
      <div className="space-y-4 px-5 py-5 sm:px-6">
        {message && (
          <p role="alert" className="text-sm text-destructive">
            {message}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm text-muted-foreground">
            {notice}
          </p>
        )}
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading sign-in methods
          </p>
        ) : (
          <>
            {methods.some((method) => method.providerId === "credential") && (
              <p className="text-xs text-muted-foreground">
                Email and password is connected.
              </p>
            )}
            {visibleProviders.map((provider) => {
              const linked = methods.filter(
                (method) => method.providerId === provider
              )
              const available = providers.data?.includes(provider)
              return (
                <div
                  key={provider}
                  className="flex flex-col gap-3 border-b pb-4 last:border-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {socialProviderLabels[provider]}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {linked.length ? "Connected" : "Not connected"}
                    </p>
                  </div>
                  {linked.length ? (
                    <div className="flex flex-wrap gap-2">
                      {linked.map((method) => (
                        <Button
                          key={method.id}
                          variant="outline"
                          size="sm"
                          onClick={() => void disconnect(method.id)}
                          disabled={
                            DEMO_MODE ||
                            Boolean(pending) ||
                            methods.length <= 1 ||
                            accounts.isError
                          }
                          aria-label={`Disconnect ${socialProviderLabels[provider]}`}
                        >
                          {pending === method.id && (
                            <Loader2 className="size-4 animate-spin" />
                          )}
                          Disconnect
                        </Button>
                      ))}
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void connect(provider)}
                      disabled={
                        DEMO_MODE ||
                        !available ||
                        Boolean(pending) ||
                        accounts.isError ||
                        providers.isError
                      }
                      aria-label={`Connect ${socialProviderLabels[provider]}`}
                    >
                      {pending === provider && (
                        <Loader2 className="size-4 animate-spin" />
                      )}
                      Connect
                    </Button>
                  )}
                </div>
              )
            })}
            {methods.length === 1 && (
              <p className="text-xs text-muted-foreground">
                Connect another sign-in method before disconnecting your last
                one.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  )
}
