import * as React from "react"
import { ArrowUpIcon, Lock, MicIcon, SquareIcon, XIcon } from "lucide-react"
import {
  AuiIf,
  ComposerPrimitive,
  useAui,
  useAuiState,
} from "@assistant-ui/react"
import { toast } from "sonner"
import { AutonomyMenu } from "./AutonomyMenu"
import { ModelMenu } from "./ModelMenu"
import { PlusMenu } from "./PlusMenu"
import { SkillMenu, useSkillMenu } from "./SkillMenu"
import type { Skill } from "@/config/skills"
import { useAIComposerPrefs } from "@/store/aiComposerPrefs"
import { getSkill } from "@/config/skills"
import { ComposerAttachments } from "@/components/assistant-ui/attachment"
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { DEMO_MODE } from "@/lib/demo"

/**
 * The composer.
 *
 *   [ + ] [ AUTO ]              …spacer…            [ Model · Effort ] [ mic ] [ send ]
 *
 * This replaces the registry's default `Composer`/`ComposerAction` pair. The rest
 * of thread.tsx — viewport, message rendering, scroll-to-bottom, edit composer —
 * is left to the registry.
 *
 * In demo mode the whole thing renders and stays interactive — menus open,
 * models switch, the send button appears and disappears — but sending is
 * intercepted with the same `toast.warning` the rest of the app uses for locked
 * features. The server refuses demo requests too; this is the half that
 * explains itself.
 */
export function SparkComposer() {
  const warnLocked = () => toast.warning("Feature locked in demo mode")

  const aui = useAui()
  const text = useAuiState((s) => s.composer.text)
  const menu = useSkillMenu(text)

  const activeSkillId = useAIComposerPrefs((s) => s.activeSkillId)
  const setActiveSkill = useAIComposerPrefs((s) => s.setActiveSkill)
  const activeSkill = getSkill(activeSkillId ?? undefined)

  // Picking a skill replaces the `/query` with the skill's own phrasing and
  // pins it as a chip. Replacing rather than clearing matters: Send only
  // renders when the composer has content, so a skill dropped into an empty box
  // could never be sent. It also leaves a readable sentence in the transcript
  // instead of a bare command.
  const selectSkill = React.useCallback(
    (skill: Skill) => {
      setActiveSkill(skill.id)
      aui.composer.setText(skill.prompt)
    },
    [aui, setActiveSkill]
  )

  return (
    <ComposerPrimitive.Root className="relative flex w-full flex-col">
      {DEMO_MODE ? (
        <div className="mb-2 flex items-center gap-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
          <Lock className="size-3.5 shrink-0" />
          Demo Mode — Spark AI is a preview here. Sign up to chat.
        </div>
      ) : null}

      {menu.open ? (
        <SkillMenu
          query={menu.query}
          matches={menu.matches}
          activeIndex={menu.activeIndex}
          onSelect={selectSkill}
        />
      ) : null}

      <ComposerPrimitive.AttachmentDropzone
        render={
          <div className="flex w-full flex-col gap-2 rounded-(--composer-radius) border border-border/60 bg-(--composer-bg) p-(--composer-padding) shadow-[0_4px_16px_-8px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] transition-[border-color,box-shadow] focus-within:border-border data-[dragging=true]:border-dashed data-[dragging=true]:border-ring dark:border-muted-foreground/15 dark:shadow-none dark:focus-within:border-muted-foreground/30" />
        }
      >
        <ComposerAttachments />

        {activeSkill ? (
          <div className="flex items-center gap-1.5 px-1 pt-0.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 py-0.5 pr-1 pl-2 text-xs font-medium text-primary">
              /{activeSkill.id}
              <button
                type="button"
                onClick={() => setActiveSkill(null)}
                className="rounded-full p-0.5 transition-colors hover:bg-primary/20"
                aria-label={`Remove the ${activeSkill.name} skill`}
              >
                <XIcon className="size-3" />
              </button>
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {activeSkill.argHint
                ? `Add ${activeSkill.argHint}`
                : activeSkill.description}
            </span>
          </div>
        ) : null}

        <ComposerPrimitive.Input
          placeholder={
            activeSkill
              ? (activeSkill.argHint ?? activeSkill.description)
              : DEMO_MODE
                ? "Ask Spark AI… (preview, type / for skills)"
                : "Ask Spark AI… or type / for skills"
          }
          className="max-h-40 min-h-10 w-full resize-none bg-transparent px-2.5 py-1 text-base caret-primary outline-none placeholder:text-muted-foreground/80"
          rows={1}
          autoFocus
          enterKeyHint="send"
          aria-label="Message input"
          onKeyDown={(event) => {
            // The slash menu takes the arrow and Enter keys while it is open,
            // ahead of both the demo interception and the composer's own send.
            if (menu.open) {
              if (event.key === "ArrowDown") {
                event.preventDefault()
                menu.move(1)
                return
              }
              if (event.key === "ArrowUp") {
                event.preventDefault()
                menu.move(-1)
                return
              }
              if (
                (event.key === "Enter" || event.key === "Tab") &&
                !event.shiftKey
              ) {
                event.preventDefault()
                if (menu.active) selectSkill(menu.active)
                return
              }
              if (event.key === "Escape") {
                event.preventDefault()
                aui.composer.setText("")
                return
              }
            }

            // Backspace on an empty box removes the skill chip, the way it
            // removes a token in any tag input.
            if (event.key === "Backspace" && text.length === 0 && activeSkill) {
              event.preventDefault()
              setActiveSkill(null)
              return
            }

            // Enter is the other way to send, so it needs the same interception
            // as the button — otherwise it would just do nothing and read as a
            // broken textarea rather than a locked feature.
            if (DEMO_MODE && event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              warnLocked()
            }
          }}
        />

        <div className="flex items-center gap-1.5">
          <PlusMenu />
          <AutonomyMenu />

          <div className="flex-1" />

          <ModelMenu />
          <MicButton />

          {/* Send is conditionally *rendered*, not disabled: with an empty
              composer there is no button in the DOM at all. `composer.isEmpty`
              is `!text.trim() && !attachments.length`, so an attachment with no
              text still reveals it. */}
          <AuiIf condition={(s) => !s.thread.isRunning && !s.composer.isEmpty}>
            {DEMO_MODE ? (
              // Same button, same position, same appear/disappear behaviour —
              // it just explains itself instead of sending.
              <TooltipIconButton
                tooltip="Locked in demo mode"
                side="bottom"
                type="button"
                variant="default"
                size="icon"
                className="size-7 rounded-full"
                aria-label="Send message (locked in demo mode)"
                data-testid="composer-send"
                onClick={warnLocked}
              >
                <ArrowUpIcon className="size-4.5" />
              </TooltipIconButton>
            ) : (
              <ComposerPrimitive.Send
                render={
                  <TooltipIconButton
                    tooltip="Send message"
                    side="bottom"
                    type="button"
                    variant="default"
                    size="icon"
                    className="size-7 rounded-full"
                    aria-label="Send message"
                    data-testid="composer-send"
                  />
                }
              >
                <ArrowUpIcon className="size-4.5" />
              </ComposerPrimitive.Send>
            )}
          </AuiIf>

          <AuiIf condition={(s) => s.thread.isRunning}>
            <ComposerPrimitive.Cancel
              render={
                <Button
                  type="button"
                  variant="default"
                  size="icon"
                  className="size-7 rounded-full"
                  aria-label="Stop generating"
                />
              }
            >
              <SquareIcon className="size-3.5 fill-current" />
            </ComposerPrimitive.Cancel>
          </AuiIf>
        </div>
      </ComposerPrimitive.AttachmentDropzone>
    </ComposerPrimitive.Root>
  )
}

/**
 * Voice input, deliberately inert.
 *
 * Placed and styled now so the row does not shift when dictation is wired up.
 * A `disabled` button swallows pointer events, so the tooltip needs a wrapping
 * element to have something that still receives hover.
 */
function MicButton() {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className="inline-flex" />}
        aria-label="Voice input (coming soon)"
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled
          tabIndex={-1}
          className="size-7 rounded-full text-muted-foreground/50"
          aria-label="Voice input (coming soon)"
        >
          <MicIcon className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Voice input is coming soon</TooltipContent>
    </Tooltip>
  )
}
