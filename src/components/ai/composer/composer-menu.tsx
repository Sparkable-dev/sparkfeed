import * as React from "react"
import { ChevronDownIcon } from "lucide-react"
import {
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

/**
 * Shared chrome for the composer's dropdowns.
 *
 * The width override in `ComposerMenuContent` is not cosmetic. The base
 * `DropdownMenuContent` sets `w-(--anchor-width)`, which matches the popup to
 * its trigger — fine for the wide triggers elsewhere in the app, but these
 * triggers are ~28px tall pills, so without `w-auto` the menus render as unusable
 * slivers. Every composer menu goes through this component for that reason.
 */
export function ComposerMenuContent({
  className,
  minWidth = 280,
  ...props
}: React.ComponentProps<typeof DropdownMenuContent> & { minWidth?: number }) {
  return (
    <DropdownMenuContent
      side="top"
      align="start"
      sideOffset={8}
      className={cn("w-auto p-1", className)}
      style={{ minWidth }}
      {...props}
    />
  )
}

/** The small pill that opens a composer menu. */
export function ComposerPill({
  icon,
  label,
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuTrigger> & {
  icon?: React.ReactNode
  label?: string
}) {
  return (
    <DropdownMenuTrigger
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-border/60 px-2 text-xs font-medium text-muted-foreground transition-colors outline-none select-none",
        "hover:bg-muted-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
        "data-popup-open:bg-muted-foreground/10 data-popup-open:text-foreground",
        label ? "px-2" : "w-7 justify-center px-0",
        className
      )}
      {...props}
    >
      {icon}
      {label ? (
        <>
          {/* Wide enough for "GPT-5.6 Luna · Medium" — the longest realistic
              model-and-effort pairing — so the pill only truncates on genuinely
              long names rather than clipping every label. */}
          <span className="max-w-[22ch] truncate">{label}</span>
          <ChevronDownIcon className="size-3 shrink-0 opacity-60" />
        </>
      ) : null}
    </DropdownMenuTrigger>
  )
}

/*
 * A `MenuSwitchItem` used to live here — a row with a switch on its right edge,
 * for the `+` menu's per-tool and per-connector toggles. Both lists are gone:
 * the tools are always available and gated by autonomy on the server, so the
 * switches were controls that changed nothing. Nothing else in the composer
 * toggles anything, so the component went with them.
 */
