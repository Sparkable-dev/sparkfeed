import * as React from "react"
import { Link, useNavigate, useRouterState } from "@tanstack/react-router"
import { ChevronRight, HistoryIcon, SearchIcon, Sparkles } from "lucide-react"
import { ChatList } from "./ChatList"
import { useChatHistory } from "./use-chat-history"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useSidebar } from "@/components/ui/sidebar"
import { isChatId } from "@/lib/chat-id"
import { DEMO_MODE } from "@/lib/demo"

const SEARCH_APPEARS_AT = 7
const HISTORY_OPEN_KEY = "sparkfeed-sidebar-history-open"

/** The label starts a chat; the separate disclosure reveals saved chats. */
export function ChatHistory() {
  const { state, isMobile, setOpenMobile } = useSidebar()
  const { threads, loading, error, refresh, rename, remove } = useChatHistory()
  const [query, setQuery] = React.useState("")
  const [open, setOpen] = React.useState(true)
  const [flyoutOpen, setFlyoutOpen] = React.useState(false)
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const threadId = pathname.startsWith("/dashboard/ai/") ? pathname.split("/")[3] : ""
  const activeId = threadId && isChatId(threadId) ? threadId : null
  const collapsed = state === "collapsed" && !isMobile

  React.useEffect(() => {
    try { setOpen(localStorage.getItem(HISTORY_OPEN_KEY) !== "false") } catch { /* Storage is optional. */ }
  }, [])

  const changeOpen = (next: boolean) => {
    setOpen(next)
    try { localStorage.setItem(HISTORY_OPEN_KEY, String(next)) } catch { /* Keep the in-memory preference. */ }
  }
  const onNavigate = () => {
    setFlyoutOpen(false)
    if (isMobile) setOpenMobile(false)
  }
  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle ? threads.filter((t) => `${t.title} ${t.preview}`.toLowerCase().includes(needle)) : threads
  }, [threads, query])

  const history = (
    <>
      {threads.length >= SEARCH_APPEARS_AT && (
        <div className="relative mb-1.5">
          <SearchIcon className="pointer-events-none absolute start-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats" aria-label="Search chats"
            className="w-full rounded-md border border-sidebar-border bg-transparent py-1.5 ps-7 pe-2 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring" />
        </div>
      )}
      <div role="region" aria-label="Recent chats" tabIndex={0}
        className="max-h-[min(12rem,28svh)] overflow-y-auto overscroll-contain [scrollbar-width:thin] [scrollbar-color:var(--sidebar-border)_transparent] focus-visible:outline-2 focus-visible:outline-ring">
        {loading && threads.length === 0 ? (
          <p role="status" className="px-2 py-3 text-xs text-muted-foreground">Loading chats…</p>
        ) : (
          <>
            {error && <div role="status" className="px-2 py-2 text-xs text-muted-foreground">
              Could not load chats. <button type="button" onClick={() => void refresh()} className="rounded underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">Retry</button>
            </div>}
            {(!error || threads.length > 0) && <ChatList threads={filtered} activeId={activeId} onRename={rename}
              onDelete={async (id) => {
                const deleted = await remove(id)
                if (deleted && id === activeId) void navigate({ to: "/dashboard/ai" })
              }}
              onNavigate={onNavigate} emptyLabel={query ? "No matching chats" : "No chats yet"} />}
          </>
        )}
      </div>
    </>
  )

  const newChat = (
    <Link to="/dashboard/ai" aria-label="Spark AI, new chat" title="New chat" onClick={onNavigate}
      className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-2 text-sm font-medium outline-none transition-colors hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-ring ${collapsed ? "size-8 flex-none justify-center p-0" : ""} ${activeId ? "text-sidebar-foreground" : "text-sidebar-foreground/80"}`}>
      <Sparkles className="size-4 shrink-0 text-sidebar-foreground/60" />
      {!collapsed && <span className="truncate">Spark AI</span>}
    </Link>
  )

  if (collapsed) return (
    <div className="flex flex-col items-center gap-1 py-1">
      {newChat}
      {!DEMO_MODE && <Popover open={flyoutOpen} onOpenChange={setFlyoutOpen}>
        <PopoverTrigger render={<button type="button" aria-label="Chat history" title="Chat history" className="grid size-8 place-items-center rounded-lg text-sidebar-foreground/60 hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-ring" />}>
          <HistoryIcon className="size-4" />
        </PopoverTrigger>
        <PopoverContent side="right" align="start" sideOffset={8} className="w-72 p-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Recent chats</p>
          {history}
        </PopoverContent>
      </Popover>}
    </div>
  )

  return (
    <div className="shrink-0 px-3">
      <Collapsible open={!DEMO_MODE && open} onOpenChange={changeOpen}>
        <div className="flex items-center gap-1">
          {newChat}
          {!DEMO_MODE && <CollapsibleTrigger render={<button type="button" aria-label={open ? "Collapse chat history" : "Expand chat history"} title={open ? "Collapse chat history" : "Expand chat history"} className="grid size-8 shrink-0 place-items-center rounded-md text-sidebar-foreground/60 hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring" />}>
            <ChevronRight className={`size-3.5 transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-90" : ""}`} />
          </CollapsibleTrigger>}
        </div>
        <CollapsibleContent>
          <div className="ml-4 mt-1 border-l border-sidebar-border pb-1 pl-3">{history}</div>
        </CollapsibleContent>
      </Collapsible>
      <div role="separator" className="-mx-3 mt-3 border-t border-sidebar-border" />
    </div>
  )
}
