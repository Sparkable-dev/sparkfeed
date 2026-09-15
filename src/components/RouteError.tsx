import { useRouter } from "@tanstack/react-router"
import { AlertTriangle, RefreshCw } from "lucide-react"
import { invalidateWorkspace } from "@/lib/workspace-query"
import { Button } from "@/components/ui/button"

/**
 * Replaces TanStack Router's default full-screen "Something went wrong!" panel,
 * which rendered the raw error (including Drizzle SQL text) at the user.
 *
 * The message here is deliberately generic; the real error still goes to the
 * console and the server logs, and the details block only shows in dev.
 */
export function RouteError({ error, reset }: { error: unknown; reset?: () => void }) {
  const router = useRouter()

  const detail =
    import.meta.env.DEV && error instanceof Error ? error.message : null

  const retry = () => {
    reset?.()
    invalidateWorkspace(router)
  }

  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center p-6">
      <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-lg border border-border dark:border-white/10 bg-muted dark:bg-white/[0.02] p-8 text-center">
        <div className="rounded-full border border-amber-500/20 bg-amber-500/10 p-3">
          <AlertTriangle className="h-5 w-5 text-amber-700 dark:text-amber-400" />
        </div>

        <div className="flex flex-col gap-1.5">
          <h2 className="text-sm font-semibold text-foreground dark:text-white">This page could not load</h2>
          <p className="text-xs leading-relaxed text-muted-foreground dark:text-zinc-400">
            Something went wrong on our side. Your feeds and saved articles are safe.
            Try again in a moment.
          </p>
        </div>

        {detail && (
          <pre className="max-h-32 w-full overflow-auto rounded border border-border dark:border-white/10 bg-card dark:bg-black/40 p-2 text-left text-[10px] text-muted-foreground dark:text-zinc-500">
            {detail}
          </pre>
        )}

        <Button size="sm" onClick={retry} className="h-8 gap-1.5 text-xs">
          <RefreshCw className="h-3 w-3" />
          Try again
        </Button>
      </div>
    </div>
  )
}
