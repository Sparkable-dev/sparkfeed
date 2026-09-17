import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { fetchOlderArticles, getSourceReadStatus } from "@/server/rss"

export function WebsiteArchive({
  feedId,
  onChanged,
}: {
  feedId: string
  onChanged?: () => void
}) {
  const changed = useRef(onChanged)
  changed.current = onChanged
  const [data, setData] = useState<Awaited<
    ReturnType<typeof getSourceReadStatus>
  > | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generation, setGeneration] = useState(0)
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let wasRunning = false
    const started = Date.now()
    setData(null)
    const poll = async () => {
      try {
        const value = await getSourceReadStatus({ data: { feedId } })
        if (cancelled) return
        setData(value)
        setError(null)
        const running = value.archive?.state === "running"
        setBusy(running)
        if ((wasRunning || generation > 0) && !running) changed.current?.()
        if (wasRunning && !value.archive)
          setError(
            "The background process restarted. Fetch older articles again to resume safely."
          )
        wasRunning = running
        if (running && Date.now() - started < 180_000)
          timer = setTimeout(poll, 2500)
        else if (running) {
          setBusy(false)
          setError("Still working. Reopen source details to check progress.")
        }
      } catch {
        if (!cancelled) {
          setBusy(false)
          setError(
            "Could not check source progress. Reopen these details to retry."
          )
        }
      }
    }
    void poll()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [feedId, generation])
  const start = async () => {
    setBusy(true)
    try {
      await fetchOlderArticles({ data: { feedId } })
      setGeneration((g) => g + 1)
      toast.success("Fetching older articles")
    } catch (err) {
      setBusy(false)
      toast.error(
        err instanceof Error ? err.message : "Could not start archive loading"
      )
    }
  }
  return (
    <div className="mt-4 space-y-2 text-xs text-muted-foreground">
      {data && (
        <>
          <p>
            {data.total} saved articles.{" "}
            {data.incomplete > 0
              ? `${data.incomplete} have no saved reader content yet; their original links remain available.`
              : "Saved reader content is available for all imported articles."}
          </p>
          {data.undated > 0 && (
            <p>
              {data.undated} have no publication date and use the date first
              added for filtering.
            </p>
          )}
          {data.latest && (
            <p>
              Latest known publication:{" "}
              {new Date(data.latest).toLocaleDateString()}.
            </p>
          )}
          {data.archive && (
            <p role="status">
              {data.archive.message}
              {data.archive.state !== "running"
                ? ` ${data.archive.inserted} articles added.`
                : ""}
            </p>
          )}
        </>
      )}
      {error && <p role="status">{error}</p>}
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => void start()}
      >
        {busy
          ? "Fetching older articles…"
          : data?.archive?.hasMore
            ? "Continue fetching older articles"
            : "Fetch older articles"}
      </Button>
      <p>
        Reads up to 5 linked archive pages per batch. Some websites only support
        loading more in their own browser. Use All Time to see older saved
        articles.
      </p>
    </div>
  )
}
