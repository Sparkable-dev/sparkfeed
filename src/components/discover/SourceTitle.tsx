import { ExternalLink } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export function SourceTitle({
  name,
  url,
}: {
  name: string
  url?: string | null
}) {
  if (!url) return <span>{name}</span>
  return (
    <Tooltip>
      <TooltipTrigger
        render={<a href={url} target="_blank" rel="noopener noreferrer" />}
        className="inline-flex max-w-full items-center gap-1.5 rounded-sm underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-2 focus-visible:outline-offset-2"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <span className="truncate">{name}</span>
        <ExternalLink
          aria-hidden="true"
          className="size-3 shrink-0 text-muted-foreground dark:text-zinc-500"
        />
      </TooltipTrigger>
      <TooltipContent className="break-all">
        Open {url} in a new tab
      </TooltipContent>
    </Tooltip>
  )
}
