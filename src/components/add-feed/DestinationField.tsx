import { useEffect, useRef } from "react"
import { X } from "lucide-react"
import type { FolderOption } from "./add-feed-context"
import type { Destination } from "@/server/services/feed-write"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { UNFILED_DESTINATION } from "@/lib/unfiled"

/**
 * Where the ticked feeds are going, including a folder that does not exist yet.
 *
 * The old dialog could do this only when more than one feed was selected, and
 * expressed it as a separate switch plus a separate text field sitting beside a
 * folder dropdown that it then had to ignore. So adding one feed to a new
 * folder — the thing people actually asked for — was not expressible at all.
 *
 * One control now. "New folder…" is an item in the same list as the folders,
 * and choosing it swaps the trigger for a text field in place.
 */

const NEW = "__new__"
const NONE = "__none__"

export function DestinationField({
  value,
  onChange,
  folders,
  disabled,
  /** Pre-fills the name when "New folder…" is chosen, e.g. the site's name. */
  suggestion,
}: {
  value: Destination
  onChange: (next: Destination) => void
  folders: Array<FolderOption>
  disabled?: boolean
  suggestion?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const creating = value.kind === "new"

  /*
    Base UI needs the value→label map on the root, not just on the items.
    Without it the trigger renders the raw value, which is why the old dialog's
    folder picker sat there reading "__none__" instead of "No folder": the
    items only exist once the popup has been opened.
  */
  const labels: Record<string, string> = {
    [NONE]: UNFILED_DESTINATION,
    [NEW]: "New folder…",
    ...Object.fromEntries(folders.map((f) => [f.id, f.name])),
  }

  // Focus follows the swap: picking "New folder…" and then having to click the
  // field that just appeared is a step that should not exist.
  useEffect(() => {
    if (creating) inputRef.current?.focus()
  }, [creating])

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 text-xs text-muted-foreground dark:text-zinc-500">Add to</span>

      {creating ? (
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <Input
            ref={inputRef}
            id="add-feed-folder-name"
            value={value.name}
            disabled={disabled}
            placeholder={suggestion || "New folder name"}
            aria-label="New folder name"
            onChange={(e) => onChange({ kind: "new", name: e.target.value })}
            className="h-8 min-w-0 flex-1 rounded-lg border-input dark:border-zinc-700/60 bg-card dark:bg-zinc-900/40 text-xs"
          />
          <button
            type="button"
            onClick={() => onChange({ kind: "none" })}
            aria-label="Cancel new folder"
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground dark:text-zinc-500
              transition-colors hover:bg-accent dark:hover:bg-white/10 hover:text-foreground dark:hover:text-zinc-200"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : (
        <Select
          items={labels}
          value={value.kind === "existing" ? value.folderId : NONE}
          disabled={disabled}
          onValueChange={(next) => {
            if (next === NEW) onChange({ kind: "new", name: suggestion ?? "" })
            else if (next === NONE || !next) onChange({ kind: "none" })
            else onChange({ kind: "existing", folderId: next })
          }}
        >
          <SelectTrigger
            id="add-feed-folder"
            aria-label="Folder"
            className="h-8 min-w-0 flex-1 rounded-lg border-input dark:border-zinc-700/60 bg-card dark:bg-zinc-900/40 text-xs"
          >
            <SelectValue placeholder={UNFILED_DESTINATION} />
          </SelectTrigger>
          <SelectContent className="max-h-64">
            <SelectItem value={NONE}>{UNFILED_DESTINATION}</SelectItem>
            {folders.map((folder) => (
              <SelectItem key={folder.id} value={folder.id}>
                {folder.name}
              </SelectItem>
            ))}
            <SelectSeparator />
            <SelectItem value={NEW}>New folder…</SelectItem>
          </SelectContent>
        </Select>
      )}
    </div>
  )
}
