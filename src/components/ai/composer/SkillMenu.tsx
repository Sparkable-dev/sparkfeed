import * as React from "react"
import {
  Compass,
  ListChecks,
  Newspaper,
  Scale,
  Stethoscope,
  Telescope,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { Skill } from "@/config/skills"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { matchSkills } from "@/config/skills"

const ICONS: Record<string, LucideIcon> = {
  Newspaper,
  Telescope,
  Scale,
  ListChecks,
  Compass,
  Stethoscope,
}

/**
 * The `/` command menu.
 *
 * Hand-rolled rather than built on cmdk or assistant-ui's slash adapter, for
 * one reason each. cmdk owns focus — its keyboard handling assumes the user is
 * typing *inside* it, but here focus must stay in the composer textarea so the
 * message keeps being typed while the menu filters. And assistant-ui's
 * `unstable_useSlashCommandAdapter` is marked "may change without notice",
 * which is not a dependency this composer should take.
 *
 * What remains is small: filter a list, track an active index, and let the
 * parent own the keys. Positioning is absolute against the composer rather than
 * a popover, which avoids a portal fighting the textarea for focus.
 */
export function SkillMenu({
  query,
  activeIndex,
  onSelect,
  matches,
}: {
  query: string
  activeIndex: number
  onSelect: (skill: Skill) => void
  matches: Array<Skill>
}) {
  if (matches.length === 0) return null

  return (
    <div
      role="listbox"
      aria-label="Skills"
      className="absolute bottom-full left-0 z-50 mb-2 w-full overflow-hidden rounded-xl border border-border/60 bg-popover shadow-2xl"
    >
      <div className="border-b border-border/50 px-3 py-1.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        Skills{query ? ` matching "${query}"` : ""}
      </div>
      <ul className="max-h-72 overflow-y-auto p-1">
        {matches.map((skill, index) => {
          const Icon = ICONS[skill.icon] ?? Newspaper
          const active = index === activeIndex
          return (
            <li key={skill.id}>
              <button
                type="button"
                role="option"
                aria-selected={active}
                // Mouse down rather than click: the textarea would lose focus
                // on mousedown otherwise, closing the menu before click fires.
                onMouseDown={(event) => {
                  event.preventDefault()
                  onSelect(skill)
                }}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors",
                  active
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-muted/60"
                )}
              >
                <Icon className="mt-0.5 size-4 shrink-0 opacity-70" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-1.5">
                    <span className="text-sm font-medium">/{skill.id}</span>
                    {skill.requiresWrite ? (
                      <Badge variant="secondary" className="text-[10px]">
                        needs permission
                      </Badge>
                    ) : null}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {skill.description}
                  </span>
                </span>
                {active ? (
                  <span className="mt-0.5 shrink-0 text-[10px] text-muted-foreground">
                    ↵
                  </span>
                ) : null}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * Slash-menu state derived from the composer text.
 *
 * The menu opens only when the text is a lone `/word` — a slash mid-sentence is
 * almost always a date or a path, and popping a command menu over those would
 * make the composer feel possessed.
 */
export function useSkillMenu(text: string) {
  const match = /^\/(\w*)$/.exec(text)
  const query = match?.[1] ?? null
  const matches = React.useMemo(
    () => (query === null ? [] : matchSkills(query)),
    [query]
  )

  const [activeIndex, setActiveIndex] = React.useState(0)

  // Reset the highlight whenever the result set changes, so Enter never lands
  // on a row that has scrolled out from under the user's typing.
  React.useEffect(() => {
    setActiveIndex(0)
  }, [query])

  const open = query !== null && matches.length > 0

  const move = React.useCallback(
    (delta: number) => {
      setActiveIndex((i) => (i + delta + matches.length) % matches.length)
    },
    [matches.length]
  )

  return {
    open,
    query: query ?? "",
    matches,
    activeIndex,
    active: matches[activeIndex],
    move,
  }
}
