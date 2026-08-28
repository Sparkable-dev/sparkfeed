import { useAui } from "@assistant-ui/react"
import { Button } from "@/components/ui/button"
import { DEMO_MODE } from "@/lib/demo"

/**
 * Starter prompts for an empty thread.
 *
 * These deliberately do not mention the user's own feeds or folders. Spark AI
 * has no workspace access yet, so a chip like "What's new in my Tech folder?"
 * would only ever produce "I can't see your feeds" — offering it would teach
 * people the assistant is broken. Feed-aware prompts return with the tools.
 */
const STARTER_PROMPTS = [
  "Suggest five RSS feeds worth following on AI research",
  "Explain the difference between RSS and Atom",
  "Summarise the article I'm about to paste",
]

/**
 * Why this is hand-rolled rather than `ThreadPrimitive.Suggestions`.
 *
 * assistant-ui's suggestion pipeline is for *follow-ups*, not starters: the AI
 * SDK runtime only asks the suggestion adapter to generate after a run finishes
 * and the last message is an assistant message (`useAISDKRuntime` bails on both
 * `!wasRunning` and `last.role !== "assistant"`). On an empty thread it is never
 * called, so the registry's suggestion block is permanently empty here.
 * `useChatRuntime`'s top-level `suggestions` option does not help either — it is
 * accepted by the type and then discarded by the implementation.
 */
export function StarterPrompts() {
  const aui = useAui()

  return (
    <div className="flex w-full flex-wrap items-center justify-center gap-2 px-4">
      {STARTER_PROMPTS.map((prompt) => (
        <div
          key={prompt}
          className="animate-in duration-200 fill-mode-both fade-in slide-in-from-bottom-2"
        >
          <Button
            variant="ghost"
            className="h-auto gap-1.5 rounded-full border border-border/60 px-3.5 py-1.5 text-sm font-normal whitespace-nowrap text-foreground transition-colors hover:bg-muted"
            onClick={() => {
              aui.composer.setText(prompt)
              // In demo mode the chip only fills the composer; the send button
              // then explains the lock rather than failing silently.
              if (!DEMO_MODE) aui.composer.send()
            }}
          >
            {prompt}
          </Button>
        </div>
      ))}
    </div>
  )
}
