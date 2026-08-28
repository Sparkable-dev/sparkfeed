import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { signature, toOrderPayload } from "./source-tree"
import type { TreeFolder } from "./source-tree"
import { DEMO_MODE } from "@/lib/demo"
import { saveSourceOrder } from "@/server/sources"

/**
 * Local arrangement state, and getting it to the server without losing a drag.
 *
 * The tree is held locally while the user is interacting, because a drag has to
 * land instantly and a round trip does not. Everything here exists to make that
 * optimism safe.
 */

export function useSourceOrder({
  loaded,
  onSaved,
}: {
  /** The arrangement as the loader last delivered it. */
  loaded: Array<TreeFolder>
  /** Called after a successful save so the caller can refresh the sidebar. */
  onSaved: () => void
}) {
  const [tree, setTree] = useState<Array<TreeFolder>>(loaded)
  const [saving, setSaving] = useState(false)

  /**
   * The last arrangement the server confirmed.
   *
   * The revert target, and deliberately not "the previous render". A user can
   * finish three drags before the first save comes back failing; stepping back
   * one would leave them somewhere the server has never seen.
   */
  const committed = useRef<Array<TreeFolder>>(loaded)

  /** Single-flight, latest-wins. See `flush`. */
  const inFlight = useRef(false)
  const pending = useRef<Array<TreeFolder> | null>(null)

  /*
    Reseed only when the loader genuinely disagrees with what we committed.
    After our own save the two match, so this does nothing and the user's tree
    is left alone; when something else changes the workspace — a delete from
    the sidebar, another tab — the signatures differ and the page catches up.
  */
  useEffect(() => {
    if (signature(loaded) !== signature(committed.current)) {
      committed.current = loaded
      setTree(loaded)
    }
  }, [loaded])

  const flush = useCallback(async () => {
    if (inFlight.current) return
    const next = pending.current
    if (!next) return

    pending.current = null
    inFlight.current = true
    setSaving(true)

    try {
      const result = await saveSourceOrder({ data: toOrderPayload(next) })

      if (result.status === "demo_locked") {
        setTree(committed.current)
        toast.warning("Feature locked in demo mode")
        return
      }
      if (result.status === "stale") {
        // Something else changed the workspace under us. The loader is the
        // authority now, so ask for it again rather than insisting.
        toast.warning("Your sources changed elsewhere, so the page was refreshed")
        onSaved()
        return
      }

      committed.current = next
      onSaved()
    } catch (error) {
      console.error("[sources] failed to save order", error)
      setTree(committed.current)
      toast.error("Could not save that change")
    } finally {
      inFlight.current = false
      setSaving(false)
      // A drag that happened while this one was in the air.
      if (pending.current) void flush()
    }
  }, [onSaved])

  /**
   * Applies an arrangement and schedules a save.
   *
   * Bails on a no-op so an accidental pick-up-and-put-back costs nothing, and
   * queues rather than racing: without the single flight, two quick drops can
   * arrive out of order and the last write to land is not the last drag made.
   */
  const apply = useCallback(
    (next: Array<TreeFolder>) => {
      if (signature(next) === signature(tree)) return

      /*
        Checked before the state change, not after. Dragging still works in the
        demo — the handles are live and the row lifts — but the drop is refused
        here, so dnd-kit animates the item home rather than the tree moving and
        visibly snapping back. Hiding the handles entirely would be worse: this
        page's whole point is the arranging, and a demo that hides its subject
        is not much of a demo.
      */
      if (DEMO_MODE) {
        toast.warning("Feature locked in demo mode")
        return
      }

      setTree(next)
      pending.current = next
      void flush()
    },
    [tree, flush],
  )

  return { tree, apply, saving }
}
