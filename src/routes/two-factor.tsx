import { createFileRoute, notFound, redirect } from "@tanstack/react-router"
import { useState } from "react"
import QRCode from "react-qr-code"
import { Copy, KeyRound, Loader2, Mail, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getPlatformAdminRouteState } from "@/server/admin/route-state"

export const Route = createFileRoute("/two-factor")({
  validateSearch: (search) => ({
    redirect: typeof search.redirect === "string" ? search.redirect : "/admin",
    method: search.method === "email" ? ("email" as const) : ("totp" as const),
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
  const { redirect: redirectTo, method: initialMethod } = Route.useSearch()
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [method, setMethod] = useState<"totp" | "email" | "backup">(
    initialMethod
  )
  const [totpUri, setTotpUri] = useState("")
  const [backupCodes, setBackupCodes] = useState<Array<string>>([])
  const [emailSent, setEmailSent] = useState(false)
  const [showManualKey, setShowManualKey] = useState(false)
  const [busy, setBusy] = useState(false)

  const enrollTotp = async () => {
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
      setMethod("totp")
      setTotpUri(result.data.totpURI)
      setBackupCodes(result.data.backupCodes)
      setCode("")
      toast.success("Scan the QR code, then enter the six-digit code.")
    }
  }

  const sendEmailCode = async () => {
    setBusy(true)
    const result = await authClient.twoFactor.sendOtp({ trustDevice: true })
    setBusy(false)
    if (result.error)
      return toast.error(
        result.error.message || "Could not send the email code."
      )

    setMethod("email")
    setEmailSent(true)
    setCode("")
    toast.success("A six-digit code was sent to your admin email.")
  }

  const verify = async () => {
    setBusy(true)
    const result =
      method === "backup"
        ? await authClient.twoFactor.verifyBackupCode({
            code: code.trim(),
            trustDevice: true,
          })
        : method === "email"
          ? await authClient.twoFactor.verifyOtp({
              code: code.trim(),
              trustDevice: true,
            })
          : await authClient.twoFactor.verifyTotp({
              code: code.trim(),
              trustDevice: true,
            })
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
              Confirm it is you before opening the admin panel.
            </p>
          </div>
        </div>
        {setupRequired && !totpUri && method !== "email" ? (
          <div className="space-y-4">
            <p className="text-sm leading-6 text-zinc-400">
              To set up Google Authenticator, enter your account password. Or
              skip setup and use a code sent to your email.
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
              onClick={() => void enrollTotp()}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <KeyRound className="size-4" />
              )}
              Set up authenticator app
            </Button>
            <Button
              variant="outline"
              className="w-full border-white/10 bg-white/5"
              disabled={busy}
              onClick={() => void sendEmailCode()}
            >
              <Mail className="size-4" />
              Skip TOTP and continue with email code
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {totpUri && method === "totp" && (
              <div className="space-y-3 rounded-xl border border-violet-500/20 bg-violet-500/5 p-4">
                <div className="mx-auto w-fit rounded-xl bg-white p-3">
                  <QRCode
                    value={totpUri}
                    size={196}
                    aria-label="Sparkfeed Admin authenticator QR code"
                  />
                </div>
                <ol className="list-decimal space-y-1 pl-5 text-sm leading-6 text-zinc-300">
                  <li>Open Google Authenticator.</li>
                  <li>Tap +, then choose Scan a QR code.</li>
                  <li>Scan this QR and enter the six-digit code below.</li>
                </ol>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-zinc-400"
                  onClick={() => setShowManualKey((value) => !value)}
                >
                  {showManualKey
                    ? "Hide setup key"
                    : "Can't scan? Show setup key"}
                </Button>
                {showManualKey && (
                  <div className="flex gap-2">
                    <code className="min-w-0 flex-1 rounded bg-black/30 p-2 text-sm break-all text-violet-200">
                      {secret}
                    </code>
                    <Button
                      size="icon"
                      variant="outline"
                      aria-label="Copy authenticator setup key"
                      onClick={() => void navigator.clipboard.writeText(secret)}
                    >
                      <Copy className="size-4" />
                    </Button>
                  </div>
                )}
                <details className="rounded-lg border border-white/10 bg-black/20 p-3">
                  <summary className="cursor-pointer text-sm text-amber-300">
                    Save your one-time backup codes
                  </summary>
                  <div className="mt-3 grid grid-cols-2 gap-1 font-mono text-sm text-zinc-300">
                    {backupCodes.map((item) => (
                      <span key={item}>{item}</span>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">
                    Store these offline. Each code works once.
                  </p>
                </details>
              </div>
            )}
            {method === "email" && (
              <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4 text-sm leading-6 text-zinc-300">
                {emailSent
                  ? "We sent a six-digit code to your admin account email. It expires in 10 minutes."
                  : "Send a six-digit code to your admin account email to continue."}
              </div>
            )}
            <div>
              <label className="mb-1.5 block text-sm text-zinc-400">
                {method === "backup"
                  ? "Backup code"
                  : method === "email"
                    ? "Six-digit email code"
                    : "Six-digit authenticator code"}
              </label>
              <Input
                value={code}
                onChange={(event) =>
                  setCode(
                    method === "backup"
                      ? event.target.value
                      : event.target.value.replace(/\D/g, "").slice(0, 6)
                  )
                }
                inputMode={method === "backup" ? "text" : "numeric"}
                autoComplete="one-time-code"
                className="border-white/10 bg-white/5 font-mono tracking-widest"
              />
            </div>
            <Button
              className="w-full"
              disabled={
                busy || !code.trim() || (method === "email" && !emailSent)
              }
              onClick={() => void verify()}
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              Verify and continue
            </Button>
            {method !== "email" && (
              <Button
                variant="outline"
                className="w-full border-white/10 bg-white/5"
                disabled={busy}
                onClick={() => void sendEmailCode()}
              >
                <Mail className="size-4" />
                {totpUri
                  ? "Skip TOTP and continue with email code"
                  : "Send a code to my email"}
              </Button>
            )}
            {method === "email" && (
              <Button
                variant={emailSent ? "ghost" : "outline"}
                className={
                  emailSent
                    ? "w-full text-zinc-400"
                    : "w-full border-white/10 bg-white/5"
                }
                disabled={busy}
                onClick={() => void sendEmailCode()}
              >
                <Mail className="size-4" />
                {emailSent ? "Resend email code" : "Send email code"}
              </Button>
            )}
            {method === "email" &&
              (totpUri || setupRequired || initialMethod === "totp") && (
                <Button
                  variant="ghost"
                  className="w-full text-zinc-400"
                  disabled={busy}
                  onClick={() => {
                    setMethod("totp")
                    setCode("")
                  }}
                >
                  {totpUri || !setupRequired
                    ? "Use authenticator code instead"
                    : "Set up authenticator app instead"}
                </Button>
              )}
            {!setupRequired && method !== "email" && (
              <Button
                variant="ghost"
                className="w-full text-zinc-400"
                onClick={() => {
                  setMethod(method === "backup" ? "totp" : "backup")
                  setCode("")
                }}
              >
                {method === "backup"
                  ? "Use authenticator code"
                  : "Use a backup code"}
              </Button>
            )}
          </div>
        )}
      </section>
    </main>
  )
}
