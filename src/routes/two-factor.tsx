import { createFileRoute, notFound, redirect } from "@tanstack/react-router"
import { useState } from "react"
import { Copy, KeyRound, Loader2, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getPlatformAdminRouteState } from "@/server/admin/route-state"

export const Route = createFileRoute("/two-factor")({
  validateSearch: (search) => ({
    redirect: typeof search.redirect === "string" ? search.redirect : "/admin",
  }),
  beforeLoad: async () => {
    const state = await getPlatformAdminRouteState()
    if (state.state === "not_found" || state.state === "forbidden")
      throw notFound()
    if (state.state === "authorized") throw redirect({ to: "/admin" })
    return { setupRequired: state.state === "totp_required" }
  },
  component: TwoFactorPage,
})

function TwoFactorPage() {
  const { setupRequired } = Route.useRouteContext()
  const { redirect: redirectTo } = Route.useSearch()
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [backupMode, setBackupMode] = useState(false)
  const [totpUri, setTotpUri] = useState("")
  const [backupCodes, setBackupCodes] = useState<Array<string>>([])
  const [busy, setBusy] = useState(false)

  const enroll = async () => {
    setBusy(true)
    const result = await authClient.twoFactor.enable({
      password,
      method: "totp",
    })
    setBusy(false)
    if (result.error)
      return toast.error(
        result.error.message || "Could not start TOTP enrollment."
      )
    if (result.data.method === "totp") {
      setTotpUri(result.data.totpURI)
      setBackupCodes(result.data.backupCodes)
      toast.success("Add the TOTP secret, then verify one code.")
    }
  }

  const verify = async () => {
    setBusy(true)
    const result = backupMode
      ? await authClient.twoFactor.verifyBackupCode({ code, trustDevice: true })
      : await authClient.twoFactor.verifyTotp({ code, trustDevice: true })
    setBusy(false)
    if (result.error)
      return toast.error(result.error.message || "That code was not accepted.")
    window.location.href = redirectTo
  }

  const secret = (() => {
    try {
      return new URL(totpUri).searchParams.get("secret") || ""
    } catch {
      return ""
    }
  })()

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#08090b] px-4 text-zinc-100">
      <section className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0d0f12] p-7 shadow-2xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-xl bg-violet-600 p-2.5">
            <ShieldCheck className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">
              Sparkfeed Admin verification
            </h1>
            <p className="text-sm text-zinc-500">
              TOTP is required for the platform administrator.
            </p>
          </div>
        </div>
        {setupRequired && !totpUri ? (
          <div className="space-y-4">
            <p className="text-sm leading-6 text-zinc-400">
              Enter the administrator password to generate the TOTP secret and
              one-time backup codes. Sparkfeed never displays the secret again
              after enrollment.
            </p>
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Administrator password"
              className="border-white/10 bg-white/5"
            />
            <Button
              className="w-full"
              disabled={busy || !password}
              onClick={() => void enroll()}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <KeyRound className="size-4" />
              )}
              Start TOTP enrollment
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {totpUri && (
              <div className="space-y-3 rounded-xl border border-violet-500/20 bg-violet-500/5 p-4">
                <div>
                  <p className="text-xs tracking-wide text-zinc-500 uppercase">
                    Authenticator secret
                  </p>
                  <div className="mt-1 flex gap-2">
                    <code className="min-w-0 flex-1 rounded bg-black/30 p-2 text-sm break-all text-violet-200">
                      {secret}
                    </code>
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() => void navigator.clipboard.writeText(secret)}
                    >
                      <Copy className="size-4" />
                    </Button>
                  </div>
                </div>
                <div>
                  <p className="text-xs tracking-wide text-zinc-500 uppercase">
                    Backup codes
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-1 font-mono text-sm text-zinc-300">
                    {backupCodes.map((item) => (
                      <span key={item}>{item}</span>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-amber-300">
                  Save these codes offline before continuing.
                </p>
              </div>
            )}
            <div>
              <label className="mb-1.5 block text-sm text-zinc-400">
                {backupMode ? "Backup code" : "Six-digit TOTP code"}
              </label>
              <Input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                inputMode={backupMode ? "text" : "numeric"}
                autoComplete="one-time-code"
                className="border-white/10 bg-white/5 font-mono tracking-widest"
              />
            </div>
            <Button
              className="w-full"
              disabled={busy || !code.trim()}
              onClick={() => void verify()}
            >
              {busy && <Loader2 className="size-4 animate-spin" />}Verify and
              trust this device
            </Button>
            {!setupRequired && (
              <Button
                variant="ghost"
                className="w-full text-zinc-400"
                onClick={() => {
                  setBackupMode((value) => !value)
                  setCode("")
                }}
              >
                {backupMode ? "Use TOTP code" : "Use a backup code"}
              </Button>
            )}
          </div>
        )}
      </section>
    </main>
  )
}
