import { FileStackIcon, FileTextIcon, Loader2Icon } from "lucide-react"
import { useArtifactPanel } from "./artifact-context"
import { ArtifactKindIcon } from "./artifact-meta"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

/**
 * Everything this conversation produced, in one place.
 *
 * Documents and the report were each reachable from exactly one spot in the
 * scrollback — the card that made them — so ten turns later the only way back
 * to a briefing was to scroll for it. They are the durable part of a chat, and
 * the chat is the least durable way to file them.
 *
 * So: one small button, one rounded panel, one flat list in the order things
 * were made. Deliberately not a file tree. There is no working directory here
 * and no context to account for; there are a handful of documents and a report,
 * and anything more elaborate would be scaffolding around four rows.
 *
 * It hides itself when there is nothing in it. A permanent empty drawer is a
 * feature asking for attention before it has earned any.
 */
export function AssetsDock() {
  const panel = useArtifactPanel()
  if (!panel) return null

  const { assets, reportSize } = panel
  const count = assets.length + (reportSize > 0 ? 1 : 0)
  if (count === 0) return null

  const openId = panel.artifact?.id

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={`Assets (${count})`}
            title="Documents and reports from this chat"
            className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/85 py-1.5 ps-2.5 pe-3 text-xs text-muted-foreground shadow-sm backdrop-blur transition-colors hover:bg-accent hover:text-foreground"
          />
        }
      >
        <FileStackIcon className="size-3.5" />
        <span className="font-medium tabular-nums text-foreground">{count}</span>
      </PopoverTrigger>

      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={8}
        className="w-72 rounded-xl p-1.5"
      >
        <p className="px-2 pt-1 pb-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
          From this chat
        </p>

        <ul
          aria-label="Assets list"
          className="max-h-[60vh] space-y-px overflow-y-auto"
        >
          {assets.map((asset) => (
            <li key={asset.id}>
              <Row
                active={asset.id === openId}
                icon={<ArtifactKindIcon kind={asset.kind} className="size-4" />}
                title={asset.title}
                meta={asset.streaming ? "writing…" : asset.meta}
                busy={asset.streaming}
                onClick={() =>
                  panel.open({
                    id: asset.id,
                    kind: asset.kind,
                    title: asset.title,
                    content: asset.content,
                    streaming: asset.streaming,
                  })
                }
              />
            </li>
          ))}

          {reportSize > 0 ? (
            <li>
              <Row
                active={openId === "report"}
                icon={<FileTextIcon className="size-4" />}
                title="Report"
                meta={`${reportSize} ${reportSize === 1 ? "block" : "blocks"}`}
                onClick={panel.openReport}
              />
            </li>
          ) : null}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

function Row({
  active,
  icon,
  title,
  meta,
  busy,
  onClick,
}: {
  active: boolean
  icon: React.ReactNode
  title: string
  meta: string
  busy?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-start transition-colors",
        active ? "bg-accent" : "hover:bg-accent/60"
      )}
    >
      <span
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-md border border-border/50 bg-muted/40",
          active ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {busy ? <Loader2Icon className="size-3.5 animate-spin" /> : icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-foreground">
          {title}
        </span>
        <span className="block truncate text-[10px] text-muted-foreground">
          {meta}
        </span>
      </span>
    </button>
  )
}
