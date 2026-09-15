import { useEffect, useRef, useState } from "react"
import { Check, Copy, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "./ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog"
import type { ReaderExport, ReaderExportInput } from "@/lib/reader-export"
import {
  prepareReaderExport,
  writeReaderClipboard,
} from "@/lib/reader-clipboard"

export function ReaderCopyButton({
  input,
  disabled,
  gutter,
  bodyHeight = 0,
}: {
  input: ReaderExportInput
  disabled: boolean
  gutter: boolean
  bodyHeight?: number
}) {
  const [state, setState] = useState<"idle" | "pending" | "copied">("idle")
  const [fallback, setFallback] = useState<ReaderExport | null>(null)
  const [message, setMessage] = useState("")
  const busy = useRef(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    if (state !== "copied") return
    const timer = setTimeout(() => setState("idle"), 2000)
    return () => clearTimeout(timer)
  }, [state])
  const label = disabled
    ? "Reader content is not available to copy"
    : input.summary
      ? "Copy summary"
      : input.partial
        ? "Copy available article content"
        : "Copy article"
  const success = (format: "rich" | "markdown") => {
    setState("copied")
    setMessage(
      `${input.summary ? "Summary" : input.partial ? "Available content" : "Article"} copied${format === "markdown" ? " as Markdown; formatted copy unavailable" : ""}.`
    )
  }
  const copy = async () => {
    if (busy.current || disabled) return
    busy.current = true
    setState("pending")
    setMessage("")
    const payload = prepareReaderExport(input)
    try {
      const format = await writeReaderClipboard(payload)
      if (alive.current) success(format)
    } catch {
      try {
        const result = await payload
        if (alive.current) {
          setFallback(result)
          setMessage(
            "Clipboard access failed. Try Copy Markdown or select the text and copy manually."
          )
        }
      } catch {
        if (alive.current) {
          const error =
            "Could not prepare this article for copying. Try again after Reader loads."
          setMessage(error)
          toast.error(error)
        }
      }
      if (alive.current) setState("idle")
    } finally {
      busy.current = false
    }
  }
  const retry = async () => {
    if (!fallback || busy.current) return
    busy.current = true
    try {
      await navigator.clipboard.writeText(fallback.markdown)
      if (alive.current) {
        success("markdown")
        setFallback(null)
      }
    } catch {
      if (alive.current)
        setMessage(
          "Clipboard access is blocked. Select the text below and use your device’s Copy command."
        )
    } finally {
      busy.current = false
    }
  }
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className={`reader-copy-button ${gutter ? "reader-copy-gutter" : ""}`}
              style={
                gutter ? { top: `calc(100% - ${bodyHeight / 2}px)` } : undefined
              }
              aria-label={label}
              aria-disabled={disabled || state === "pending"}
              onClick={() => {
                void copy()
              }}
            />
          }
        >
          {state === "copied" ? (
            <Check aria-hidden="true" className="size-4" />
          ) : state === "pending" ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Copy aria-hidden="true" className="size-4" />
          )}
        </TooltipTrigger>
        <TooltipContent>{state === "copied" ? "Copied" : label}</TooltipContent>
      </Tooltip>
      <span className="sr-only" role="status">
        {message}
      </span>
      <Dialog
        open={!!fallback}
        onOpenChange={(open) => {
          if (!open) setFallback(null)
        }}
      >
        <DialogContent>
          <DialogTitle>Copy article</DialogTitle>
          <DialogDescription>
            {message || "Select the Markdown below to copy it manually."}
          </DialogDescription>
          <textarea
            aria-label="Article Markdown"
            readOnly
            value={fallback?.markdown ?? ""}
            className="h-64 w-full resize-y rounded border p-3 font-mono text-sm"
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button
            onClick={() => {
              void retry()
            }}
          >
            Copy Markdown
          </Button>
        </DialogContent>
      </Dialog>
    </>
  )
}
