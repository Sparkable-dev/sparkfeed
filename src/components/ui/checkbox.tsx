"use client"

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { Check, Minus } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * The primitive the Add dialog needed and the project did not have.
 *
 * The old Add Feed modal drew one by hand — a styled `<span>` inside a
 * `<button>` — which looks right and is not: no `role`, no checked state to
 * read out, and a label that is not associated with anything.
 *
 * Written against `@base-ui/react` in the style of `switch.tsx` rather than
 * pulled from the registry, so it matches the components already here.
 */
function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer size-4 shrink-0 rounded-[4px] border border-zinc-600 bg-transparent",
        "flex items-center justify-center transition-colors outline-none",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "data-checked:border-primary data-checked:bg-primary",
        "data-indeterminate:border-primary data-indeterminate:bg-primary",
        "data-disabled:cursor-not-allowed data-disabled:opacity-40",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-primary-foreground"
      >
        {/*
          `indeterminate` is the select-all box's normal resting state when some
          but not all rows are ticked, so it needs its own mark rather than
          borrowing the tick.
        */}
        {props.indeterminate ? (
          <Minus className="size-3" strokeWidth={3} />
        ) : (
          <Check className="size-3" strokeWidth={3} />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
