import { createFileRoute, redirect } from "@tanstack/react-router"
import { newChatId } from "@/lib/chat-id"

/**
 * "New chat" — mints an id and hands over to the thread route.
 *
 * `beforeLoad` rather than a redirect after render, so the URL is right before
 * anything paints and the back button never lands on a page that immediately
 * bounces again. `replace` for the same reason.
 *
 * No row is written here. The thread appears in the sidebar when the first
 * exchange is saved, so opening the AI page and changing your mind leaves
 * nothing behind.
 */

/*
  One id per pending new chat, rather than one per evaluation.

  `beforeLoad` runs on preload as well as on navigation, and minting inside it
  meant hovering "Spark AI" warmed `/dashboard/ai/cht_A` while clicking it
  landed on `/dashboard/ai/cht_B`. The preloaded match was for a route the user
  never visited, so the AI page was the one page in the app that could never be
  preloaded — it ran its loader from cold on every visit, and ran it twice.

  So a preload peeks at the pending id and a real navigation consumes it. The
  next new chat mints again, because the last one has been handed out.
*/
let pendingId: string | null = null

function nextChatId(preload: boolean): string {
  /*
    Browser only. This module is shared across every request the server handles,
    so a pending id cached here would be one user's chat id offered to the next
    one. Preloading is a client behaviour, so the cache has no reason to exist
    on the server and every reason not to.
  */
  if (typeof window === "undefined") return newChatId()

  pendingId ??= newChatId()
  if (preload) return pendingId

  const id = pendingId
  pendingId = null
  return id
}

export const Route = createFileRoute("/_protected/dashboard/ai/")({
  beforeLoad: ({ preload }) => {
    throw redirect({
      to: "/dashboard/ai/$threadId",
      params: { threadId: nextChatId(preload) },
      replace: true,
    })
  },
})
