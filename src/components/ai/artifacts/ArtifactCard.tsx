import * as React from "react"
import { FileTextIcon, Loader2Icon, PanelRightOpenIcon } from "lucide-react"
import { useArtifactPanel } from "./artifact-context"
import { ArtifactKindIcon, artifactMeta } from "./artifact-meta"
import type { ArtifactArgs } from "@/server/ai/artifacts"
import type { ToolStatus } from "@/components/ai/tools/shared"
import { cn } from "@/lib/utils"

/**
 * The artifact's stand-in inside the conversation.
 *
 * It renders from `args`, not `result` — the tool returns only an
 * acknowledgement, and the document itself arrives as the call's arguments,
 * partially parsed on every chunk. That is what makes the line count tick up
 * while the model writes, and what lets the panel show a half-finished document
 * rather than a spinner.
 *
 * The card stays in the thread after the panel closes, so a conversation with
 * four artifacts still has four openable places, in the order they were made.
 */
export function ArtifactCard({
  args,
  toolCallId,
  status,
}: {
  args?: Partial<ArtifactArgs>
  toolCallId?: string
  status?: ToolStatus
}) {
  const panel = useArtifactPanel()

  const id = toolCallId ?? ""
  const title = args?.title?.trim() || "Untitled document"
  const kind = args?.kind ?? "markdown"
  const content = args?.content ?? ""
  const streaming = status?.type === "running"
  const isOpen = panel?.artifact?.id === id

  // Keep the open panel in step with the stream. Depends on `sync` rather than
  // on `panel`, which is a new object every time the open document changes —
  // and this effect is what changes it.
  const sync = panel?.sync
  React.useEffect(() => {
    if (!sync || !isOpen) return
    sync({ id, title, kind, content, streaming })
  }, [sync, isOpen, id, title, kind, content, streaming])

  /*
    File it in the dock, whether or not the panel is open.

    Registering from the card rather than collecting from the message list is
    what makes the dock survive a reload for free: on load the transcript
    re-renders every card it had, and each one puts itself back. Nothing extra
    is stored, and there is no second parser for tool arguments.
  */
  const registerAsset = panel?.registerAsset
  const meta = artifactMeta(kind, content)
  React.useEffect(() => {
    if (!registerAsset || !id) return
    registerAsset({ id, kind, title, meta, content, streaming })
  }, [registerAsset, id, kind, title, meta, content, streaming])

  const open = () => panel?.open({ id, title, kind, content, streaming })

  // Nothing worth showing until the model has named the thing. Without this the
  // first chunk flashes an empty card.
  if (!args?.title && !content) {
    return (
      <div className="my-2 flex items-center gap-2 rounded-xl border border-border/60 bg-card/40 px-3 py-2.5 text-xs text-muted-foreground">
        <Loader2Icon className="size-3.5 animate-spin" />
        Starting a document…
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={open}
      disabled={!panel}
      aria-label={`Open ${title}`}
      className={cn(
        "group my-2 flex w-full items-center gap-3 rounded-xl border bg-card/40 px-3 py-2.5 text-start transition-colors",
        "hover:border-primary/40 hover:bg-card/70 disabled:pointer-events-none",
        isOpen ? "border-primary/50 bg-card/70" : "border-border/60"
      )}
    >
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-lg border border-border/50 bg-muted/50 text-muted-foreground",
          isOpen && "border-primary/30 text-primary"
        )}
      >
        <ArtifactKindIcon kind={kind} className="size-4" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {title}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {streaming ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2Icon className="size-3 animate-spin" />
              Writing… {meta}
            </span>
          ) : (
            <>
              {meta}
              {isOpen ? " · open in the panel" : ""}
            </>
          )}
        </span>
      </span>

      {panel ? (
        <span className="shrink-0 text-muted-foreground group-hover:text-foreground">
          <PanelRightOpenIcon className="size-4" />
        </span>
      ) : (
        <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
      )}
    </button>
  )
}
