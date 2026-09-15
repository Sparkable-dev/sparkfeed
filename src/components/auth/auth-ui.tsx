import { useState } from "react"
import { Eye, EyeOff } from "lucide-react"
import { toast } from "sonner"
import type { ReactNode } from "react"
import { useThemeCycle } from "@/hooks/use-theme-cycle"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

// Shared geometry and original assets from Shadcn Space's auth 02 blocks.
export function AuthLayout({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-[#f3f2f7] bg-[radial-gradient(ellipse_65%_75%_at_50%_50%,rgba(112,85,255,0.11)_0%,rgba(112,85,255,0.035)_45%,transparent_80%)] px-4 py-8 text-foreground dark:bg-[#0d0c12] dark:bg-[radial-gradient(ellipse_65%_75%_at_50%_50%,rgba(112,85,255,0.13)_0%,rgba(112,85,255,0.04)_45%,transparent_80%)]">
      <Card className="grid w-full max-w-5xl grid-cols-1 gap-0 overflow-hidden rounded-2xl border-[#e4e2eb] bg-transparent p-0 shadow-[0_12px_40px_-16px_rgba(30,24,50,0.14)] md:grid-cols-2 dark:border-white/10 dark:shadow-none">
        <div className="flex min-w-0 flex-col justify-center bg-[#faf9fd]/94 p-6 backdrop-blur-[12px] sm:p-10 dark:bg-[#19181e]/94 [&_input]:bg-white [&_input]:font-normal dark:[&_input]:bg-[#25242a]">
          <div className="mb-8 flex items-center justify-between gap-4">
            <a
              href="/"
              className="flex w-fit items-center gap-2.5"
              aria-label="Sparkfeed home"
            >
              <img
                src="/favicon.svg"
                alt=""
                width={26}
                height={26}
                className="size-[26px] shrink-0"
              />
              <span className="text-lg leading-none font-semibold tracking-tight">
                Sparkfeed
              </span>
            </a>
            <AuthThemeToggle />
          </div>
          <h1 className="text-[28px] leading-tight font-normal">{title}</h1>
          {description && (
            <p className="mt-1 text-sm font-medium text-muted-foreground">
              {description}
            </p>
          )}
          {children}
        </div>
        <div className="relative hidden min-h-[450px] md:block">
          <img
            src="/images/auth/sparkfeed-angled-workspace-v1.webp"
            width={1122}
            height={1402}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
        </div>
      </Card>
    </main>
  )
}
export function SocialButtons({ action }: { action: "sign-in" | "sign-up" }) {
  return (
    <>
      <div className="mt-6 mb-4 grid grid-cols-2 gap-3 md:gap-6">
        {(["Google", "GitHub"] as const).map((provider) => (
          <Button
            key={provider}
            variant="outline"
            type="button"
            className="h-9 cursor-pointer gap-2 rounded-lg text-sm shadow-xs dark:bg-background"
            onClick={() => toast.info(`${provider} ${action} is coming soon.`)}
          >
            {provider === "Google" ? (
              <img
                src="https://images.shadcnspace.com/assets/svgs/icon-google.svg"
                alt=""
                className="h-4 w-4"
              />
            ) : (
              <>
                <img
                  src="https://images.shadcnspace.com/assets/svgs/icon-github.svg"
                  alt=""
                  className="h-4 w-4 dark:hidden"
                />
                <img
                  src="https://images.shadcnspace.com/assets/svgs/icon-github-white.svg"
                  alt=""
                  className="hidden h-4 w-4 dark:block"
                />
              </>
            )}
            {provider}
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <hr className="grow border-border" />
        <p className="text-sm font-medium text-muted-foreground">
          or {action === "sign-in" ? "sign in" : "sign up"} with email
        </p>
        <hr className="grow border-border" />
      </div>
    </>
  )
}
export function PasswordField({
  value,
  onChange,
  disabled,
  isNew = false,
  error,
  onBlur,
}: {
  value: string
  onChange: (value: string) => void
  disabled: boolean
  isNew?: boolean
  error?: string
  onBlur?: () => void
}) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="space-y-1.5">
      <Label htmlFor="password">Password</Label>
      <div className="relative">
        <Input
          id="password"
          name="password"
          type={visible ? "text" : "password"}
          autoComplete={isNew ? "new-password" : "current-password"}
          required
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          placeholder={isNew ? "Create a password" : "Enter your password"}
          className="h-10 pr-11 shadow-xs"
          onBlur={onBlur}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "password-error" : undefined}
        />
        <button
          type="button"
          onClick={() => setVisible(!visible)}
          disabled={disabled}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-md text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      <FieldError id="password-error" message={error} />
    </div>
  )
}
export function AuthError({ message }: { message?: string }) {
  return message ? (
    <p
      role="alert"
      className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
    >
      {message}
    </p>
  ) : null
}

export function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={id} aria-live="polite" className="text-xs text-destructive">
      {message}
    </p>
  ) : null
}
function AuthThemeToggle() {
  const { mounted, current, next, Icon, cycle } = useThemeCycle()
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      disabled={!mounted}
      onClick={cycle}
      title={`Theme: ${current}. Switch to ${next}.`}
      aria-label={`Theme: ${current}. Switch to ${next}.`}
      className="shrink-0 rounded-full text-muted-foreground"
    >
      <Icon className="size-4" />
    </Button>
  )
}
