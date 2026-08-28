import * as React from "react"
import { AlertTriangleIcon } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { isToolError } from "@/lib/tool-result"

/**
 * Shared chrome for tool results.
 *
 * Every renderer has the same three states — running, failed, done — and
 * repeating that branch in six components is how they drift apart. `ToolResult`
 * owns the branch; each renderer only describes the "done" case.
 *
 * `isToolError` comes from `@/lib/tool-result` rather than the server tool types
 * module: it is a runtime value, and a value import from `@/server` would pull
 * the whole services layer into the browser bundle.
 */

export function ToolCard({
  icon: Icon,
  title,
  meta,
  children,
  className,
}: {
  icon?: LucideIcon
  title: string
  meta?: React.ReactNode
  children?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "my-2 overflow-hidden rounded-xl border border-border/60 bg-card/40",
        className
      )}
    >
      <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
        {Icon ? (
          <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        ) : null}
        <span className="text-xs font-medium text-foreground">{title}</span>
        {meta ? (
          <span className="ml-auto text-xs text-muted-foreground">{meta}</span>
        ) : null}
      </div>
      {children}
    </div>
  )
}

export function ToolRunning({ label }: { label: string }) {
  return (
    <ToolCard title={label}>
      <div className="space-y-2 p-3">
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </ToolCard>
  )
}

export function ToolFailed({ message }: { message: string }) {
  return (
    <div className="my-2 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
      <AlertTriangleIcon className="mt-px size-3.5 shrink-0" />
      <span>{message}</span>
    </div>
  )
}

/** Status as assistant-ui reports it on a tool part. */
export interface ToolStatus {
  type: "running" | "complete" | "incomplete" | "requires-action"
}

/**
 * Renders the running and failed states, and hands a typed result to `children`
 * only once there is one. Written as a generic so each caller keeps its own
 * result type rather than casting.
 */
export function ToolResult<T>({
  status,
  result,
  runningLabel,
  children,
}: {
  status?: ToolStatus
  result?: T | undefined
  runningLabel: string
  children: (result: T) => React.ReactNode
}) {
  if (isToolError(result)) return <ToolFailed message={result.error.message} />
  // `incomplete` with no result means the run was cancelled or the model gave
  // up mid-call; showing a spinner forever would be a lie.
  if (result === undefined || result === null) {
    if (status?.type === "incomplete") {
      return <ToolFailed message="That lookup did not finish." />
    }
    return <ToolRunning label={runningLabel} />
  }
  return <>{children(result)}</>
}

/** "3 days ago" style, kept short for dense tables. */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—"
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return "—"
  const mins = Math.round((Date.now() - then) / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return `${Math.round(days / 30)}mo ago`
}
