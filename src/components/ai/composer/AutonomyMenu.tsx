import { ComposerMenuContent, ComposerPill } from "./composer-menu"
import type { AutonomyId } from "@/store/aiComposerPrefs"
import {
  DropdownMenu,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu"
import { AUTONOMY_OPTIONS, useAIComposerPrefs } from "@/store/aiComposerPrefs"

/**
 * How much Spark AI may do without asking.
 *
 * The selection is persisted but not yet sent to the server — there are no write
 * tools for it to govern, and shipping a field the backend ignores invites the
 * assumption that it is being enforced. When workspace tools land, this value
 * narrows the tool set (it may only ever restrict what the session already
 * permits, never widen it).
 */
export function AutonomyMenu() {
  const autonomy = useAIComposerPrefs((s) => s.autonomy)
  const setAutonomy = useAIComposerPrefs((s) => s.setAutonomy)

  const active =
    AUTONOMY_OPTIONS.find((o) => o.id === autonomy) ?? AUTONOMY_OPTIONS[2]

  return (
    <DropdownMenu>
      <ComposerPill
        label={active?.pill ?? "AUTO"}
        aria-label={`Autonomy: ${active?.label}`}
      />
      <ComposerMenuContent minWidth={264}>
        <DropdownMenuRadioGroup
          value={autonomy}
          onValueChange={(value) => setAutonomy(value as AutonomyId)}
        >
          {/* Inside the RadioGroup, not above it — Base UI's GroupLabel throws
              without a MenuGroupContext from a Group or RadioGroup ancestor. */}
          <DropdownMenuLabel>Autonomy</DropdownMenuLabel>
          {AUTONOMY_OPTIONS.map((option) => (
            <DropdownMenuRadioItem
              key={option.id}
              value={option.id}
              closeOnClick
              className="items-start py-1.5"
            >
              <span className="flex min-w-0 flex-col">
                <span>{option.label}</span>
                <span className="text-xs text-muted-foreground">
                  {option.hint}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </ComposerMenuContent>
    </DropdownMenu>
  )
}
