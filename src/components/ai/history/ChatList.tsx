import * as React from "react"
import { Link } from "@tanstack/react-router"
import { CheckIcon, MoreHorizontal, PencilIcon, Trash2Icon, XIcon } from "lucide-react"
import { shortAge } from "./use-chat-history"
import type { ChatSummary } from "./use-chat-history"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

/**
 * The history list, used both in the expanded sidebar and in the flyout the
 * collapsed rail opens. One component so the two cannot drift into showing
 * different things — the flyout is the only view a collapsed sidebar has, and
 * a reduced copy of the list would quietly become the real one.
 *
 * Flat, in recency order. It used to bucket rows under Today / Yesterday /
 * Previous 7 days, which put a second row of uppercase labels inside a section
 * that already had one, and in a column this narrow that heading costs as much
 * vertical space as the chat it introduces. The per-row age already says when,
 * more precisely and without spending a line on it.
 */
export function ChatList({
  threads,
  activeId,
  onRename,
  onDelete,
  onNavigate,
  emptyLabel = "No chats yet",
}: {
  threads: Array<ChatSummary>
  activeId: string | null
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
  onNavigate?: () => void
  emptyLabel?: string
}) {
  const [editing, setEditing] = React.useState<string | null>(null)

  if (threads.length === 0) {
    return (
      <p className="px-2 py-3 text-xs text-sidebar-foreground/40">
        {emptyLabel}
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-px">
      {threads.map((thread) =>
        editing === thread.id ? (
          <li key={thread.id}>
            <RenameRow
              title={thread.title}
              onCancel={() => setEditing(null)}
              onSave={(title) => {
                setEditing(null)
                if (title && title !== thread.title) {
                  onRename(thread.id, title)
                }
              }}
            />
          </li>
        ) : (
          <li key={thread.id} className="group/chat relative">
            <Link
              to="/dashboard/ai/$threadId"
              params={{ threadId: thread.id }}
              onClick={onNavigate}
              aria-current={thread.id === activeId ? "page" : undefined}
              title={thread.preview || thread.title}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-2 pr-9 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                thread.id === activeId
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60"
              )}
            >
              {/*
                The active row is marked with a rule down its start edge rather
                than a bullet on every row. A dot per row is three columns of
                furniture for one row's worth of information, and it ate width
                the title needed.
              */}
              <span
                aria-hidden
                className={cn(
                  "absolute inset-y-1 start-0 w-0.5 rounded-full bg-primary",
                  thread.id === activeId ? "block" : "hidden"
                )}
              />
              <span className="flex-1 truncate">{thread.title}</span>
              {/*
                The age is replaced by the actions on hover rather than sitting
                beside them. At this width both together push the title into an
                ellipsis on almost every row.
              */}
              <span className="absolute end-2 top-1/2 -translate-y-1/2 text-[11px] tabular-nums text-muted-foreground opacity-0 [@media(hover:hover)]:opacity-100 group-hover/chat:opacity-0 group-focus-within/chat:opacity-0 group-has-[[data-popup-open]]/chat:opacity-0">
                {shortAge(thread.updatedAt)}
              </span>
            </Link>

            <div className="absolute end-1 top-1/2 -translate-y-1/2 opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 group-hover/chat:opacity-100 group-focus-within/chat:opacity-100 has-[[data-popup-open]]:opacity-100">
              <DropdownMenu>
                <DropdownMenuTrigger render={<button type="button" aria-label={`Actions for ${thread.title}`} className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring" />}>
                  <MoreHorizontal className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="right">
                  <DropdownMenuItem onClick={() => setEditing(thread.id)}><PencilIcon className="size-4" />Rename</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onDelete(thread.id)} className="text-destructive"><Trash2Icon className="size-4" />Delete</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </li>
        )
      )}
    </ul>
  )
}

function RowAction({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      // The row is a link, so a click here would follow it as well.
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClick()
      }}
      className="grid size-7 place-items-center rounded text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  )
}

function RenameRow({
  title,
  onSave,
  onCancel,
}: {
  title: string
  onSave: (title: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = React.useState(title)

  return (
    <div className="flex items-center gap-1 px-2 py-1">
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSave(value.trim())
          if (e.key === "Escape") onCancel()
        }}
        aria-label="Conversation title"
        className="min-w-0 flex-1 rounded border border-sidebar-border bg-sidebar-accent/40 px-1.5 py-1 text-sm text-sidebar-foreground outline-none focus:border-primary/50"
      />
      <RowAction label="Save" onClick={() => onSave(value.trim())}>
        <CheckIcon className="size-3" />
      </RowAction>
      <RowAction label="Cancel" onClick={onCancel}>
        <XIcon className="size-3" />
      </RowAction>
    </div>
  )
}
