import { Link } from "@tanstack/react-router"
import { CompassIcon } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * Replaces TanStack Router's built-in not-found renderer, which is the literal
 * string "Not Found" on a blank document — no styling, no navigation, and no
 * way back into the app short of editing the URL.
 *
 * Reached by a stale link, a mistyped address, or a deleted conversation, so it
 * says what happened without guessing which of those it was, and always offers
 * a way out.
 */
export function RouteNotFound() {
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center bg-background p-6">
      <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-lg border border-border/60 bg-muted/20 p-8 text-center">
        <div className="rounded-full border border-primary/20 bg-primary/10 p-3">
          <CompassIcon className="size-5 text-primary" />
        </div>

        <div className="flex flex-col gap-1.5">
          <h2 className="text-sm font-semibold text-foreground">
            This page does not exist
          </h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            The link may be out of date, or whatever it pointed at has since
            been deleted. Nothing else has been affected.
          </p>
        </div>

        <Button size="sm" className="h-8 text-xs" render={<Link to="/" />}>
          Back to Home
        </Button>
      </div>
    </div>
  )
}
