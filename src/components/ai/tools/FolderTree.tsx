import { FolderIcon } from "lucide-react"
import { ToolCard, ToolResult } from "./shared"
import type { ToolStatus } from "./shared"
import type { FolderRow, ListFoldersResult } from "@/server/tools/types"

/**
 * The folder tree.
 *
 * Nesting is reconstructed from `parent_id` here rather than server-side: the
 * service returns a flat list because that is what every other caller wants,
 * and the tree is a presentation concern. Any folder whose parent is missing
 * from the list is treated as a root, so a partial result still renders instead
 * of silently dropping rows.
 */
export function FolderTree({
  result,
  status,
}: {
  result?: ListFoldersResult
  status?: ToolStatus
}) {
  return (
    <ToolResult
      result={result}
      status={status}
      runningLabel="Reading your folders…"
    >
      {(data) => {
        const byParent = groupByParent(data.folders)
        const total = data.folders.length

        return (
          <ToolCard
            icon={FolderIcon}
            title="Folders"
            meta={`${total} ${total === 1 ? "folder" : "folders"}`}
          >
            {total === 0 ? (
              <p className="px-3 py-2.5 text-xs text-muted-foreground">
                No folders yet.
              </p>
            ) : (
              <div className="py-1">
                <Branch parentId={null} byParent={byParent} depth={0} />
              </div>
            )}
          </ToolCard>
        )
      }}
    </ToolResult>
  )
}

function groupByParent(
  folders: Array<FolderRow>
): Map<string | null, Array<FolderRow>> {
  const ids = new Set(folders.map((f) => f.id))
  const map = new Map<string | null, Array<FolderRow>>()
  for (const folder of folders) {
    // An unknown parent means the row would otherwise be unreachable; promote
    // it to a root so nothing disappears from the list.
    const key =
      folder.parent_id && ids.has(folder.parent_id) ? folder.parent_id : null
    map.set(key, [...(map.get(key) ?? []), folder])
  }
  return map
}

function Branch({
  parentId,
  byParent,
  depth,
}: {
  parentId: string | null
  byParent: Map<string | null, Array<FolderRow>>
  depth: number
}) {
  const children = byParent.get(parentId) ?? []
  if (children.length === 0) return null

  return (
    <>
      {children.map((folder) => (
        <div key={folder.id}>
          <div
            className="flex items-center gap-2 px-3 py-1 text-xs"
            style={{ paddingLeft: `${12 + depth * 14}px` }}
          >
            <FolderIcon className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate text-foreground">{folder.name}</span>
            <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">
              {folder.feed_count} {folder.feed_count === 1 ? "feed" : "feeds"}
              {folder.unread_count > 0
                ? ` · ${folder.unread_count} unread`
                : ""}
            </span>
          </div>
          {/* The depth cap is load-bearing, not cosmetic. `folders.parent_id`
              has no foreign key and nothing rejects a cycle, so A→B→A is
              storable — and would recurse forever here without a bound. */}
          {depth < 4 ? (
            <Branch
              parentId={folder.id}
              byParent={byParent}
              depth={depth + 1}
            />
          ) : null}
        </div>
      ))}
    </>
  )
}
