import { useEffect, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { useWorkspaceScope } from "./WorkspaceDataProvider"
import { Button } from "./ui/button"
import { setFavorites } from "@/server/reader-data"
import { workspaceKey } from "@/lib/workspace-query"

/** Explicit opt-in: the old storage key did not record an account or workspace. */
export function RecoverFavorites() {
  const scope = useWorkspaceScope()
  const client = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [available, setAvailable] = useState(false)
  useEffect(() => {
    try {
      const stored = JSON.parse(
        localStorage.getItem("rss-reader-favorites") ?? "null"
      )
      setAvailable(
        Array.isArray(stored?.state?.favorites) &&
          stored.state.favorites.length > 0
      )
    } catch {
      setAvailable(false)
    }
  }, [])
  if (!scope || !available) return null
  const recover = async () => {
    setBusy(true)
    try {
      const stored = JSON.parse(
        localStorage.getItem("rss-reader-favorites") ?? "null"
      )
      const ids = Array.isArray(stored?.state?.favorites)
        ? [
            ...new Set<string>(
              stored.state.favorites.filter(
                (id: unknown) => typeof id === "string"
              )
            ),
          ]
        : []
      let recovered = 0
      for (let offset = 0; offset < ids.length; offset += 500) {
        const result = await setFavorites({
          data: {
            ...scope,
            ids: ids.slice(offset, offset + 500),
            scope: "personal",
            state: true,
          },
        })
        recovered += result.ids.length
      }
      await client.invalidateQueries({ queryKey: workspaceKey(scope) })
      toast.success(
        recovered
          ? `Recovered ${recovered} personal favorites in this workspace.`
          : "No recoverable browser favorites in this workspace."
      )
    } catch {
      toast.error(
        "Could not recover favorites. The browser copy has been kept."
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mx-5 my-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <span>
        Missing an older save? Recover this browser's legacy favorites into your
        personal list. Only use this on a browser you used yourself.
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => void recover()}
      >
        {busy ? "Recovering…" : "Recover browser favorites"}
      </Button>
    </div>
  )
}
