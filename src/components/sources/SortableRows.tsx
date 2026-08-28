import { useDroppable } from "@dnd-kit/core"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { DragHandle } from "./SourceRows"
import type { ReactNode } from "react"

/**
 * The dnd-kit wrappers, kept apart from the rows they wrap.
 *
 * `SourceRows` stays presentational so it can also render inside a drag
 * overlay, where being sortable would be circular. This file is the only place
 * that knows dnd-kit exists.
 */

/*
  Ids are namespaced by kind. A folder can then never be dropped into a folder,
  and a feed never between folders, because the two id spaces never collide —
  which is the cheapest possible enforcement of "this tree is two levels deep".
*/
export const folderDragId = (id: string) => `folder:${id}`
export const feedDragId = (id: string) => `feed:${id}`

export function parseDragId(
  raw: string | number,
): { kind: "folder" | "feed"; id: string } | null {
  const value = String(raw)
  if (value.startsWith("folder:")) return { kind: "folder", id: value.slice(7) }
  if (value.startsWith("feed:")) return { kind: "feed", id: value.slice(5) }
  return null
}

export function SortableFolder({
  id,
  name,
  children,
}: {
  id: string
  name: string
  children: (handle: ReactNode) => ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: folderDragId(id),
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      /*
        Half-opacity rather than hidden. The row keeps its height, so the rows
        below do not jump the moment a drag starts, and the gap where the item
        came from stays legible as "this is what you are holding".
      */
      className={`min-w-0 ${isDragging ? "opacity-40" : ""}`}
    >
      {children(
        <DragHandle label={`Reorder ${name}`} {...attributes} {...listeners} />,
      )}
    </div>
  )
}

export function SortableFeed({
  id,
  name,
  children,
}: {
  id: string
  name: string
  children: (handle: ReactNode) => ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: feedDragId(id),
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`min-w-0 ${isDragging ? "opacity-40" : ""}`}
    >
      {children(<DragHandle label={`Move ${name}`} {...attributes} {...listeners} />)}
    </div>
  )
}

/**
 * Makes a folder's body a drop target in its own right.
 *
 * Without this you cannot drop a feed into an empty folder at all: a
 * `SortableContext` with no items has nothing to collide with, so the folder is
 * invisible to the drag. This is also what makes dropping onto a collapsed
 * folder work.
 */
export function FolderDropZone({
  folderId,
  children,
}: {
  folderId: string
  children: ReactNode
}) {
  const { setNodeRef } = useDroppable({ id: `folder-body:${folderId}` })
  return (
    <div ref={setNodeRef} className="min-w-0">
      {children}
    </div>
  )
}

export function parseDropZoneId(raw: string | number): string | null {
  const value = String(raw)
  return value.startsWith("folder-body:") ? value.slice(12) : null
}
