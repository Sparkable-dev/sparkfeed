import * as React from "react"
import { useRouterState } from "@tanstack/react-router"
import { toast } from "sonner"
import { deleteChat, listChats, renameChat } from "@/server/chats"
import { DEMO_MODE } from "@/lib/demo"

export interface ChatSummary {
  id: string
  title: string
  preview: string
  updatedAt: string
  messageCount: number
}

const listeners = new Set<() => void>()

/*
  A finished turn is the moment a new conversation becomes worth showing, and
  nothing otherwise tells the sidebar it happened: the row is written
  server-side once the stream ends, and that write is deliberately not awaited
  into the response (see `onEnd` in routes/api/chat.ts). So the client hears
  "done" a beat before the row exists.

  Hence a nudge on a short settle delay rather than an immediate refetch. If it
  still loses the race nothing is broken — the route-change and focus refreshes
  below remain the guarantee, and this only makes the common case not need one.
*/
const SETTLE_MS = 1200

/** Called by the chat when a turn finishes. */
export function notifyChatSaved(): void {
  setTimeout(() => {
    for (const listener of listeners) listener()
  }, SETTLE_MS)
}

/**
 * The sidebar's view of the chat history.
 *
 * Refetching is tied to the URL rather than to a timer or a subscription. A
 * thread is written server-side at the end of a stream, so the client is never
 * told when it lands; but every route change is a moment the user could be
 * looking at the list, and leaving a conversation is exactly when its title
 * should appear. Focus covers the other case — a second tab.
 *
 * Demo mode never fetches. It has no signed-in user, so the list is always
 * empty, and asking anyway would put a failing request on every page load.
 */
export function useChatHistory() {
  const [threads, setThreads] = React.useState<Array<ChatSummary>>([])
  const [error, setError] = React.useState(false)
  const [loading, setLoading] = React.useState(!DEMO_MODE)

  const pathname = useRouterState({ select: (s) => s.location.pathname })

  const refresh = React.useCallback(async () => {
    if (DEMO_MODE) {
      setLoading(false)
      return
    }
    try {
      const rows = await listChats({ data: {} })
      setThreads(rows)
      setError(false)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  // `pathname` in the deps rather than a mount-only effect: navigating away
  // from a conversation is the moment its title becomes worth showing.
  React.useEffect(() => {
    void refresh()
  }, [refresh, pathname])

  React.useEffect(() => {
    const onFocus = () => void refresh()
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [refresh])

  React.useEffect(() => {
    const listener = () => void refresh()
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [refresh])

  const rename = React.useCallback(async (id: string, title: string) => {
    // Optimistic, because the row is right under the cursor and a round trip
    // makes a rename feel like it did not take.
    setThreads((current) =>
      current.map((t) => (t.id === id ? { ...t, title } : t))
    )
    try {
      await renameChat({ data: { threadId: id, title } })
    } catch {
      toast.error("Could not rename that chat")
      void refresh()
    }
  }, [refresh])

  const remove = React.useCallback(async (id: string) => {
    const previous = threads
    setThreads((current) => current.filter((t) => t.id !== id))
    try {
      await deleteChat({ data: { threadId: id } })
      toast.success("Chat deleted")
      return true
    } catch {
      // Put it back rather than leaving the sidebar claiming something was
      // deleted that is still there.
      setThreads(previous)
      toast.error("Could not delete that chat")
      return false
    }
  }, [threads])

  return { threads, loading, error, refresh, rename, remove }
}

/** "1h", "20h", "3d" — the compact form a dense list has room for. */
export function shortAge(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ""
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60000))
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d`
  return `${Math.round(days / 30)}mo`
}

/*
 * `groupChats` — Today / Yesterday / Previous 7 days buckets — used to live
 * here. The list is flat now: see the note in ChatList.tsx for why.
 */
