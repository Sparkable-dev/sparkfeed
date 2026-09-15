import { Check, Loader2, LogIn, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DEMO_MODE } from "@/lib/demo"
import { useGuestShare } from "@/hooks/guest-share-context"

/**
 * The one thing a guest can act on: sign in, and take the folder with them.
 *
 * Lives in the sidebar footer, where an authenticated user sees the developer
 * links — the same slot the demo-mode chip uses, so a mode-specific block there
 * is an established shape rather than a new one.
 *
 * Hidden entirely in demo mode: `/sign-in` redirects straight back to `/` there,
 * so both buttons would dead-end without explanation.
 */
export function GuestUpsellCard() {
  const guest = useGuestShare()
  if (!guest) return null

  const loginHref = `/sign-in?redirect=${encodeURIComponent(`/sprk/${guest.folderSlug}`)}`

  // The copy still belongs on a demo deployment — it explains what this is —
  // but both buttons would dead-end there, so they come off rather than the
  // whole card.
  if (DEMO_MODE) {
    return (
      <div className="mx-1 mb-2 flex flex-col gap-1 rounded-xl border border-border dark:border-zinc-800 bg-card dark:bg-zinc-900/60 p-3 group-data-[collapsible=icon]:hidden">
        <p className="text-sm font-semibold text-foreground dark:text-zinc-100">Sign in to Sparkfeed</p>
        <p className="text-xs leading-relaxed text-muted-foreground dark:text-zinc-400">
          It's free. Follow any site, organise it your way, and read it all in
          one place.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-1 mb-2 flex flex-col gap-2.5 rounded-xl border border-border dark:border-zinc-800 bg-card dark:bg-zinc-900/60 p-3 group-data-[collapsible=icon]:hidden">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-foreground dark:text-zinc-100">
          Sign in to Sparkfeed
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground dark:text-zinc-400">
          It's free. Follow any site, organise it your way, and read it all in
          one place.
        </p>
      </div>

      {/*
        A real navigation, not a router link: signing in reloads the app, and
        the redirect has to survive that.
      */}
      <Button
        size="sm"
        className="h-8 w-full bg-primary dark:bg-white text-xs font-semibold text-primary-foreground dark:text-black hover:bg-primary/90 dark:hover:bg-zinc-200"
        render={<a href={loginHref} />}
      >
        <LogIn className="mr-1.5 size-3.5" />
        Sign in
      </Button>

      <Button
        size="sm"
        variant="outline"
        onClick={guest.addToWorkspace}
        disabled={guest.adding || guest.added}
        className="h-8 w-full border-border dark:border-zinc-700 text-xs font-medium text-foreground dark:text-zinc-300 hover:bg-accent dark:hover:bg-white/5 hover:text-foreground dark:hover:text-white"
      >
        {guest.adding ? (
          <>
            <Loader2 className="mr-1.5 size-3.5 animate-spin" />
            Adding…
          </>
        ) : guest.added ? (
          <>
            <Check className="mr-1.5 size-3.5" />
            Added
          </>
        ) : (
          <>
            <Plus className="mr-1.5 size-3.5" />
            Add this {guest.kind} to your workspace
          </>
        )}
      </Button>
    </div>
  )
}
