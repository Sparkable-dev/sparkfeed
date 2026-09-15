import { useState } from "react"
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { GripVertical } from "lucide-react"
import { resolveDrop } from "./resolve-drop"
import { feedDragId, folderDragId, parseDragId, parseDropZoneId } from "./SortableRows"
import type { ReactNode } from "react"
import type { TreeFolder } from "./source-tree"
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core"

/**
 * Turns drags into tree operations.
 *
 * Deliberately the only place that reasons about drop targets, so the tree
 * helpers stay pure and testable and the rows stay presentational.
 */

export function SourcesDnd({
  tree,
  onApply,
  children,
}: {
  tree: Array<TreeFolder>
  onApply: (next: Array<TreeFolder>) => void
  children: (state: { activeLabel: string | null; dropTargetId: string | null }) => ReactNode
}) {
  const [activeLabel, setActiveLabel] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)

  const sensors = useSensors(
    /*
      A small distance threshold, so a click on the handle is still a click.
      Without it, every mousedown starts a drag and the row menus become hard
      to open on a trackpad.
    */
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const labelFor = (raw: string | number): string | null => {
    const parsed = parseDragId(raw)
    if (!parsed) return null
    if (parsed.kind === "folder") {
      return tree.find((f) => f.id === parsed.id)?.name ?? null
    }
    for (const folder of tree) {
      const feed = folder.feeds.find((f) => f.id === parsed.id)
      if (feed) return feed.name
    }
    return null
  }

  const handleStart = (event: DragStartEvent) => {
    setActiveLabel(labelFor(event.active.id))
  }

  const handleEnd = (event: DragEndEvent) => {
    setActiveLabel(null)
    setDropTargetId(null)

    const { active, over } = event
    if (!over) return

    const next = resolveDrop(tree, active.id, over.id)
    if (next) onApply(next)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleStart}
      onDragOver={(event) => {
        const body = event.over ? parseDropZoneId(event.over.id) : null
        setDropTargetId(body)
      }}
      onDragCancel={() => {
        setActiveLabel(null)
        setDropTargetId(null)
      }}
      onDragEnd={handleEnd}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) => `Picked up ${labelFor(active.id) ?? "item"}.`,
          onDragOver: ({ active, over }) =>
            over
              ? `${labelFor(active.id) ?? "Item"} is over ${labelFor(over.id) ?? "a folder"}.`
              : `${labelFor(active.id) ?? "Item"} is no longer over a target.`,
          onDragEnd: ({ active, over }) =>
            over
              ? `${labelFor(active.id) ?? "Item"} dropped onto ${labelFor(over.id) ?? "a folder"}.`
              : `${labelFor(active.id) ?? "Item"} returned to where it started.`,
          onDragCancel: ({ active }) =>
            `Dragging ${labelFor(active.id) ?? "item"} cancelled.`,
        },
      }}
    >
      <SortableContext
        items={tree.filter((f) => f.isRealFolder).map((f) => folderDragId(f.id))}
        strategy={verticalListSortingStrategy}
      >
        {/*
          One sortable context per folder for its feeds, nested inside the
          folder one. Feeds and folders never share a context, which is what
          stops a feed being sorted into the folder list.
        */}
        {children({ activeLabel, dropTargetId })}
      </SortableContext>

      <DragOverlay>
        {activeLabel && (
          <div
            className="flex items-center gap-2 rounded-lg border border-border dark:border-white/15 bg-card dark:bg-zinc-900/95
              px-3 py-2 text-xs font-medium text-foreground dark:text-zinc-100 shadow-2xl backdrop-blur"
          >
            <GripVertical className="size-3.5 text-muted-foreground dark:text-zinc-500" />
            {activeLabel}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}

export function FeedSortableContext({
  folder,
  children,
}: {
  folder: TreeFolder
  children: ReactNode
}) {
  return (
    <SortableContext
      items={folder.feeds.map((f) => feedDragId(f.id))}
      strategy={verticalListSortingStrategy}
    >
      {children}
    </SortableContext>
  )
}
