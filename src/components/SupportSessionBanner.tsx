import { authClient } from "@/lib/auth-client"

export function SupportSessionBanner() {
  const { data } = authClient.useSession()
  const session = data?.session
  if (!session || !("impersonatedBy" in session) || typeof session.impersonatedBy !== "string" || !session.impersonatedBy) return null
  return (
    <div
      role="status"
      className="sticky top-0 z-[100] flex flex-wrap items-center justify-between gap-3 border-b border-amber-400/30 bg-amber-950 px-5 py-3 text-sm text-amber-100"
    >
      <span>
        Support session · Viewing as {data?.user.email}. This session expires in
        10 minutes.
      </span>
      <button
        className="rounded-md border border-amber-300/40 px-3 py-1 text-xs font-medium"
        onClick={async () => {
          await authClient.signOut()
          window.location.href = "/sign-in"
        }}
      >
        Exit support session
      </button>
    </div>
  )
}
