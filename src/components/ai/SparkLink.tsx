import * as React from "react"
import { Copy, ExternalLink, Globe } from "lucide-react"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { Button } from "@/components/ui/button"
import { copyText } from "@/lib/clipboard"

export interface SparkLinkProps {
  url: string
  children: React.ReactNode
}

export function SparkLink({ url, children }: SparkLinkProps) {
  const [copied, setCopied] = React.useState(false)

  const handleCopy = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // The check state used to flash even when the copy failed, which on a
    // non-HTTPS origin it always did.
    if (await copyText(url, { successMessage: null })) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleOpen = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    window.open(url, "_blank", "noopener noreferrer")
  }

  let displayUrl = url
  try {
    const parsed = new URL(url)
    let path = parsed.pathname
    if (path === "/") path = ""
    displayUrl = parsed.hostname + path
    if (displayUrl.length > 35) {
      displayUrl =
        displayUrl.substring(0, 20) +
        "..." +
        displayUrl.substring(displayUrl.length - 12)
    }
  } catch (e) {}

  return (
    <HoverCard>
      <HoverCardTrigger
        delay={200}
        closeDelay={200}
        render={
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline decoration-muted-foreground/50 underline-offset-4 transition-colors hover:decoration-foreground"
          >
            {children}
          </a>
        }
      />
      <HoverCardContent
        className="w-[450px] border-border bg-popover p-3 shadow-md"
        align="start"
        sideOffset={4}
      >
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-500">
            <Globe className="h-5 w-5" />
          </div>
          <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
            <span className="truncate text-sm font-semibold text-foreground">
              {children}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {displayUrl}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 bg-background text-xs"
              onClick={handleCopy}
            >
              <Copy className="h-3 w-3" />
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 bg-background text-xs"
              onClick={handleOpen}
            >
              <ExternalLink className="h-3 w-3" />
              Open
            </Button>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}
