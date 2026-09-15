import { useNavigate } from "@tanstack/react-router"
import { Check, ChevronDown } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

/**
 * Jumps between categories from the breadcrumb.
 *
 * Replaces the chip strip that used to sit at the top of this page. The strip
 * was fifteen names competing with the heading for a decision most people make
 * once; folded into the breadcrumb it costs a single chevron and puts the
 * switcher exactly where the current category is already named.
 */
export function CategorySwitcher({
  categories,
  activeSlug,
}: {
  categories: Array<{ slug: string; name: string }>
  activeSlug: string
}) {
  const navigate = useNavigate()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Switch category"
        className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground dark:text-zinc-500
          transition-colors hover:bg-accent dark:hover:bg-white/5 hover:text-foreground dark:hover:text-zinc-200"
      >
        <ChevronDown className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        /* Fifteen items overflow a short viewport; scroll rather than clip. */
        className="max-h-[70vh] min-w-[220px] overflow-y-auto rounded-xl border border-border dark:border-zinc-700/60
          bg-card dark:bg-[#0a0a0a] p-1 text-foreground dark:text-zinc-200 shadow-2xl"
      >
        {categories.map((c) => {
          const active = c.slug === activeSlug
          return (
            <DropdownMenuItem
              key={c.slug}
              onClick={() =>
                void navigate({
                  to: "/discover/$categorySlug",
                  params: { categorySlug: c.slug },
                })
              }
              className={[
                "flex cursor-pointer items-center justify-between rounded-lg px-3 py-1.5 text-xs transition-colors",
                active
                  ? "font-medium text-blue-700 dark:text-blue-400 focus:bg-blue-500/10 focus:text-blue-700 dark:focus:text-blue-400"
                  : "text-muted-foreground dark:text-zinc-400 hover:text-foreground dark:hover:text-white focus:bg-accent dark:focus:bg-zinc-800",
              ].join(" ")}
            >
              {c.name}
              {active && <Check className="size-3.5 text-blue-700 dark:text-blue-400" />}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
