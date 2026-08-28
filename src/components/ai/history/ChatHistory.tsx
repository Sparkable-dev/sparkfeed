import * as React from "react"
import { Link, useRouterState } from "@tanstack/react-router"
import { HistoryIcon, PlusIcon, SearchIcon } from "lucide-react"
import { ChatList } from "./ChatList"
import { useChatHistory } from "./use-chat-history"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useSidebar } from "@/components/ui/sidebar"
import { DEMO_MODE } from "@/lib/demo"

/**
 * Saved conversations, under Spark AI.
 *
 * Two presentations of one list. Expanded, it is a scrolling section in the
 * sidebar; collapsed to the icon rail there is nowhere to put a list, so the
 * same list opens in a flyout beside the rail.
 *
 * The search box only appears once there are enough chats to need it. A filter
 * over four rows is furniture.
 */
const SEARCH_APPEARS_AT = 7

export function ChatHistory() {
  const { state } = useSidebar()
  const { threads, rename, remove } = useChatHistory()
  const [query, setQuery] = React.useState("")

  const activeId = useRouterState({
    select: (s) => {
      const match = /^\/dashboard\/ai\/(cht_[a-z0-9]+)/.exec(s.location.pathname)
      return match?.[1] ?? null
    },
  })

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return threads
    return threads.filter(
      (t) =>
        t.title.toLowerCase().includes(needle) ||
        t.preview.toLowerCase().includes(needle)
    )
  }, [threads, query])

  // Demo mode cannot reach a model, so the history is permanently empty and an
  // empty section under Spark AI would just look broken.
  if (DEMO_MODE) return null

  if (state === "collapsed") {
    return (
      <div className="flex justify-center py-1">
        <Popover>
          <PopoverTrigger
            render={
              <button
                type="button"
                aria-label="Chat history"
                className="grid size-8 place-items-center rounded-lg text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              />
            }
          >
            <HistoryIcon className="size-4" />
          </PopoverTrigger>
          <PopoverContent
            side="right"
            align="start"
            sideOffset={8}
            className="w-72 p-2"
          >
            <div className="flex items-center justify-between px-2 pb-1">
              <span className="text-xs font-medium text-foreground/70">
                Recent
              </span>
              <NewChatLink />
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              <ChatList
                threads={threads}
                activeId={activeId}
                onRename={rename}
                onDelete={remove}
              />
            </div>
          </PopoverContent>
        </Popover>
      </div>
    )
  }

  return (
    <div className="flex flex-col px-3 pt-3">
      {/* Same size, weight and left edge as the Folders heading below it. Two
          section headings a few rows apart that do not match read as a mistake. */}
      <div className="mb-1 flex items-center justify-between px-2">
        <span className="text-[11px] font-semibold tracking-widest text-sidebar-foreground/40 uppercase select-none">
          History
        </span>
        <NewChatLink />
      </div>

      {threads.length >= SEARCH_APPEARS_AT ? (
        <div className="relative mb-1.5">
          <SearchIcon className="pointer-events-none absolute start-2 top-1/2 size-3 -translate-y-1/2 text-sidebar-foreground/35" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats"
            aria-label="Search chats"
            className="w-full rounded-md border border-sidebar-border/60 bg-sidebar-accent/30 py-1 ps-7 pe-2 text-xs text-sidebar-foreground placeholder:text-sidebar-foreground/35 outline-none focus:border-primary/40"
          />
        </div>
      ) : null}

      {/*
        A bounded, scrolling box. Left to grow, a long history pushes the folder
        tree below the fold and the sidebar stops being navigation.

        It is drawn as one: a border and a recessed background, so where the
        scrolling region starts and stops is visible before you touch it. Bare
        `overflow-y-auto` on a transparent div gave a list that clipped
        mid-row against nothing, which looked like a rendering fault rather than
        more content.
      */}
      <div className="max-h-[30vh] overflow-y-auto overscroll-contain rounded-lg border border-sidebar-border/50 bg-sidebar-accent/15 p-1">
        <ChatList
          threads={filtered}
          activeId={activeId}
          onRename={rename}
          onDelete={remove}
          emptyLabel={query ? "No matching chats" : "No chats yet"}
        />
      </div>
    </div>
  )
}

/** Always available, so a saved chat is never a dead end. */
function NewChatLink() {
  return (
    <Link
      to="/dashboard/ai"
      aria-label="New chat"
      title="New chat"
      className="grid size-5 place-items-center rounded text-sidebar-foreground/45 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
    >
      <PlusIcon className="size-3.5" />
    </Link>
  )
}
