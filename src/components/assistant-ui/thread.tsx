"use client"

import {
  ActionBarMorePrimitive,
  ActionBarPrimitive,
  AuiIf,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  useMessageTiming,
} from "@assistant-ui/react"
import {
  ArrowDownIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RefreshCwIcon,
} from "lucide-react"
import { createContext, useContext } from "react"
import type {
  AssistantState,
  PartState,
  ToolCallMessagePartComponent,
} from "@assistant-ui/react"
import type { ComponentType, FC } from "react"
import {
  ActivityGroup,
  ActivityThought,
  ActivityToolLine,
} from "@/components/assistant-ui/activity-group"
import { UserMessageAttachments } from "@/components/assistant-ui/attachment"
import { SparkComposer } from "@/components/ai/composer/SparkComposer"
import { ThreadFollowupSuggestions } from "@/components/assistant-ui/follow-up-suggestions"
import { MarkdownText } from "@/components/assistant-ui/markdown-text"
import { StarterPrompts } from "@/components/ai/StarterPrompts"
import { Reasoning } from "@/components/assistant-ui/reasoning"
import { ToolFallback } from "@/components/assistant-ui/tool-fallback"
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * Which parts of a turn belong in the activity rail, and which belong in the
 * transcript.
 *
 * The first version of this asked whether a tool had a card. That turned out to
 * be the wrong question — nearly every tool has one, so nearly everything landed
 * in the transcript, and a turn that looked up the workspace to answer a
 * question rendered as: rail, a table of eleven feeds, rail, a list of eight
 * articles, rail, four charts, and then the answer. The tables were the model
 * *working*, printed at the same size and weight as the thing it was working
 * towards.
 *
 * So the question is now about the reader rather than the tool: is this card the
 * answer, or is it how the answer was found?
 *
 *   - The answer — an article to read, a feed to subscribe to, a chart, a
 *     document — goes in the transcript, where it is the point.
 *   - The working — listing feeds, searching articles, sizing up the workspace,
 *     searching the web — goes on the rail, folded away under "Worked for 8s",
 *     one line each, expandable to the full card for anyone who wants to check.
 *
 * Two exceptions route back to the transcript regardless of tool, and both are
 * about not hiding something the reader has to act on:
 *   - `requires-action` — an approval prompt inside a collapsed group is a
 *     conversation that has silently stopped.
 *   - `incomplete` — a failure nobody sees is a failure nobody can work around.
 */
const ACTIVITY = ["group-activity"] as const
const TRANSCRIPT = [] as const

/**
 * Tools whose card *is* the answer.
 *
 * Everything else the model can call is a lookup, and lookups go on the rail —
 * including tools with no renderer at all, which is where this list used to
 * start and end.
 *
 * `get_article` and `read_url` used to be here, on the reasoning that an article
 * card is something the reader wants. It is — when the article is the point.
 * Asked for a weekly digest, though, the model reads ten articles to write it,
 * and ten cards stacked above a one-paragraph answer is the model showing its
 * homework. Reading is how an answer gets made, not the answer, so it goes on
 * the rail like every other lookup.
 *
 * Showing an article to the reader still has a surface, and a better one: the
 * article panel, opened from the Read button on the card the rail folds away —
 * or from a link in the reply, which is where a cited article belongs.
 */
const ANSWER_TOOLS = new Set([
  // Feeds the user can subscribe to from the card itself.
  "find_feeds",
  "verify_feed",
  "add_feed",
  // A figure worth keeping, and the document beside the chat.
  "chart_workspace",
  "create_artifact",
])

/*
  Defined once at module scope on purpose. `GroupedParts` memoizes its tree on
  the groupBy's identity (or its memo-key fingerprint, which only the built-in
  helper carries), so a function rebuilt each render would rebuild the whole
  part tree with it.
*/
export function groupSparkParts(
  part: PartState
): ReadonlyArray<"group-activity"> | [] {
  if (part.type === "reasoning") return ACTIVITY

  if (part.type === "tool-call") {
    if (part.status?.type === "requires-action") return TRANSCRIPT
    if (part.status?.type === "incomplete") return TRANSCRIPT
    return ANSWER_TOOLS.has(part.toolName) ? TRANSCRIPT : ACTIVITY
  }

  // Text closes the rail, which is what makes the answer follow the work
  // rather than sit inside it.
  return TRANSCRIPT
}

/**
 * Optional component overrides for the thread. `AssistantMessage` and
 * `Welcome` replace whole sections; `ToolFallback` renders a tool call with no
 * toolkit renderer of its own. Tool UIs registered by name (toolkit `render`,
 * `useAssistantDataUI`) take precedence over `ToolFallback`.
 *
 * The `ToolGroup` and `ReasoningGroup` slots are gone. They overrode the
 * per-step disclosures that `ActivityGroup` replaced, nothing in the app ever
 * passed one, and leaving a slot that can no longer be filled is worse than
 * removing it.
 */
export type ThreadComponents = {
  AssistantMessage?: ComponentType | undefined
  Welcome?: ComponentType | undefined
  ToolFallback?: ToolCallMessagePartComponent | undefined
}

export type ThreadProps = {
  components?: ThreadComponents | undefined
}

const EMPTY_COMPONENTS: ThreadComponents = {}

const ThreadComponentsContext =
  createContext<ThreadComponents>(EMPTY_COMPONENTS)

// Startup exposes a loading placeholder thread; treat it as a new chat so
// the composer mounts centered. Loads after startup keep the docked layout.
const isNewChatView = (s: AssistantState) =>
  s.thread.messages.length === 0 && (!s.thread.isLoading || s.threads.isLoading)

export const Thread: FC<ThreadProps> = ({ components = EMPTY_COMPONENTS }) => {
  const isEmpty = useAuiState(isNewChatView)

  return (
    <ThreadComponentsContext.Provider value={components}>
      <ThreadRoot isEmpty={isEmpty} />
    </ThreadComponentsContext.Provider>
  )
}

const ThreadRoot: FC<{ isEmpty: boolean }> = ({ isEmpty }) => {
  const { Welcome = ThreadWelcome } = useContext(ThreadComponentsContext)

  return (
    <ThreadPrimitive.Root
      className="aui-root aui-thread-root @container flex h-full flex-col bg-background"
      style={{
        ["--thread-max-width" as string]: "44rem",
        ["--composer-bg" as string]:
          "color-mix(in oklab, var(--color-muted) 30%, var(--color-background))",
        ["--composer-radius" as string]: "1.5rem",
        ["--composer-padding" as string]: "8px",
      }}
    >
      <ThreadPrimitive.Viewport
        turnAnchor="top"
        data-slot="aui_thread-viewport"
        className="relative flex flex-1 flex-col overflow-x-auto overflow-y-scroll scroll-smooth"
      >
        <div
          className={cn(
            "mx-auto flex w-full max-w-(--thread-max-width) flex-1 flex-col px-4 pt-4",
            isEmpty && "justify-center"
          )}
        >
          <AuiIf condition={isNewChatView}>
            <Welcome />
          </AuiIf>

          <div
            data-slot="aui_message-group"
            className="mb-14 flex flex-col gap-y-6 empty:hidden"
          >
            <ThreadPrimitive.Messages>
              {() => <ThreadMessage />}
            </ThreadPrimitive.Messages>
          </div>

          <ThreadPrimitive.ViewportFooter
            className={cn(
              "aui-thread-viewport-footer flex flex-col gap-4 overflow-visible bg-background pb-4 md:pb-6",
              !isEmpty &&
                "sticky bottom-0 mt-auto rounded-t-(--composer-radius)"
            )}
          >
            <ThreadScrollToBottom />
            <ThreadFollowupSuggestions />
            {/* Sparkfeed's composer replaces the registry default. Everything
                else in this file is left as generated so it stays easy to
                re-pull. See src/components/ai/composer/SparkComposer.tsx. */}
            <SparkComposer />
            <AuiIf condition={(s) => isNewChatView(s) && s.composer.isEmpty}>
              {/* Sparkfeed: hand-rolled starters. The registry's
                  ThreadPrimitive.Suggestions is fed by a pipeline that only
                  fires after an assistant turn, so it is always empty on a new
                  chat — see StarterPrompts.tsx. */}
              <StarterPrompts />
            </AuiIf>
          </ThreadPrimitive.ViewportFooter>
        </div>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  )
}

const ThreadMessage: FC = () => {
  const { AssistantMessage: AssistantMessageComponent = AssistantMessage } =
    useContext(ThreadComponentsContext)
  const role = useAuiState((s) => s.message.role)
  const isEditing = useAuiState((s) => s.message.composer.isEditing)

  if (isEditing) return <EditComposer />
  if (role === "user") return <UserMessage />
  return <AssistantMessageComponent />
}

const ThreadScrollToBottom: FC = () => {
  return (
    <ThreadPrimitive.ScrollToBottom
      render={
        <TooltipIconButton
          tooltip="Scroll to bottom"
          variant="outline"
          className="aui-thread-scroll-to-bottom absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible dark:border-border dark:bg-background dark:hover:bg-accent"
        />
      }
    >
      <ArrowDownIcon />
    </ThreadPrimitive.ScrollToBottom>
  )
}

const ThreadWelcome: FC = () => {
  return (
    <div className="aui-thread-welcome-root mb-6 flex flex-col items-center px-4 text-center">
      <h1 className="aui-thread-welcome-message-inner animate-in text-2xl font-semibold duration-200 fill-mode-both fade-in slide-in-from-bottom-1">
        What can I help you with?
      </h1>
    </div>
  )
}

/*
 * The registry's ThreadSuggestions / ThreadSuggestionItem were removed rather
 * than left in place: ThreadPrimitive.Suggestions is fed only by the follow-up
 * pipeline, which the AI SDK runtime never runs on an empty thread, so they
 * rendered nothing. StarterPrompts.tsx replaces them.
 */

const MessageError: FC = () => {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="aui-message-error-root mt-2 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive dark:bg-destructive/5 dark:text-red-200">
        <ErrorPrimitive.Message className="aui-message-error-message line-clamp-2" />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  )
}

const AssistantMessage: FC = () => {
  const { ToolFallback: ToolFallbackComponent = ToolFallback } = useContext(
    ThreadComponentsContext
  )

  // Read here rather than inside ActivityGroup: this hook needs the message
  // scope, and keeping the rail free of it leaves that component renderable
  // anywhere.
  const timing = useMessageTiming()

  const ACTION_BAR_PT = "pt-1.5"
  // Keep the action bar inside the contained root's paint box, then cancel its reserved space in flow.
  const ACTION_BAR_HEIGHT = `min-h-7.5 ${ACTION_BAR_PT}`

  return (
    <MessagePrimitive.Root
      data-slot="aui_assistant-message-root"
      data-role="assistant"
      className="relative -mb-7.5 animate-in pb-7.5 duration-150 [contain-intrinsic-size:auto_200px] [content-visibility:auto] fade-in slide-in-from-bottom-1"
    >
      <div
        data-slot="aui_assistant-message-content"
        className="px-2 leading-relaxed wrap-break-word text-foreground"
      >
        <MessagePrimitive.GroupedParts groupBy={groupSparkParts}>
          {({ part, children }) => {
            switch (part.type) {
              case "group-activity":
                return (
                  <ActivityGroup
                    running={part.status.type === "running"}
                    steps={part.indices.length}
                    elapsedMs={timing?.totalStreamTime}
                  >
                    {children}
                  </ActivityGroup>
                )
              case "text":
                return <MarkdownText />
              case "reasoning":
                // Always inside the rail — `groupSparkParts` sends every
                // reasoning part there — so it renders as a node rather than
                // carrying its own disclosure.
                return (
                  <ActivityThought>
                    <Reasoning {...part} />
                  </ActivityThought>
                )
              case "tool-call":
                // Same three questions `groupSparkParts` asked, in the same
                // order, so a part cannot be sorted one way and drawn another.
                if (
                  part.status?.type === "requires-action" ||
                  part.status?.type === "incomplete"
                ) {
                  return <ToolFallbackComponent {...part} />
                }
                if (ANSWER_TOOLS.has(part.toolName) && part.toolUI) {
                  return part.toolUI
                }
                // On the rail. The card still exists and is still worth having
                // — it is just not worth having *by default* — so the line
                // carries it and opens on request.
                return (
                  <ActivityToolLine {...part}>{part.toolUI}</ActivityToolLine>
                )
              case "data":
                return part.dataRendererUI
              case "indicator":
                return (
                  <span
                    data-slot="aui_assistant-message-indicator"
                    className="animate-pulse font-sans"
                    aria-label="Assistant is working"
                  >
                    {"●"}
                  </span>
                )
              default:
                return null
            }
          }}
        </MessagePrimitive.GroupedParts>
        <MessageError />
      </div>

      <div
        data-slot="aui_assistant-message-footer"
        className={cn("ms-2 flex items-center", ACTION_BAR_HEIGHT)}
      >
        <BranchPicker />
        <AssistantActionBar />
      </div>
    </MessagePrimitive.Root>
  )
}

const AssistantActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-assistant-action-bar-root col-start-3 row-start-2 -ms-1 flex animate-in gap-1 text-muted-foreground duration-200 fade-in"
    >
      <ActionBarPrimitive.Copy render={<TooltipIconButton tooltip="Copy" />}>
        <AuiIf condition={(s) => s.message.isCopied}>
          <CheckIcon className="animate-in duration-200 ease-out zoom-in-50 fade-in" />
        </AuiIf>
        <AuiIf condition={(s) => !s.message.isCopied}>
          <CopyIcon className="animate-in duration-150 zoom-in-75 fade-in" />
        </AuiIf>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload
        render={<TooltipIconButton tooltip="Refresh" />}
      >
        <RefreshCwIcon />
      </ActionBarPrimitive.Reload>
      <ActionBarMorePrimitive.Root>
        <ActionBarMorePrimitive.Trigger
          render={
            <TooltipIconButton
              tooltip="More"
              className="data-[state=open]:bg-accent"
            />
          }
        >
          <MoreHorizontalIcon />
        </ActionBarMorePrimitive.Trigger>
        <ActionBarMorePrimitive.Content
          side="bottom"
          align="start"
          sideOffset={6}
          className="aui-action-bar-more-content z-50 min-w-[8rem] overflow-hidden rounded-xl border bg-popover/95 p-1.5 text-popover-foreground shadow-lg backdrop-blur-sm data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <ActionBarPrimitive.ExportMarkdown
            render={
              <ActionBarMorePrimitive.Item className="aui-action-bar-more-item flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground" />
            }
          >
            <DownloadIcon className="size-4" />
            Export as Markdown
          </ActionBarPrimitive.ExportMarkdown>
        </ActionBarMorePrimitive.Content>
      </ActionBarMorePrimitive.Root>
    </ActionBarPrimitive.Root>
  )
}

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      data-slot="aui_user-message-root"
      className="grid animate-in auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 duration-150 [contain-intrinsic-size:auto_200px] [content-visibility:auto] fade-in slide-in-from-bottom-1 [&:where(>*)]:col-start-2"
      data-role="user"
    >
      <UserMessageAttachments />

      <div className="aui-user-message-content-wrapper relative col-start-2 min-w-0">
        <div className="aui-user-message-content peer rounded-xl bg-muted px-4 py-2 wrap-break-word text-foreground empty:hidden">
          <MessagePrimitive.Parts />
        </div>
        <div className="aui-user-action-bar-wrapper absolute start-0 top-1/2 -translate-x-full -translate-y-1/2 pe-2 peer-empty:hidden rtl:translate-x-full">
          <UserActionBar />
        </div>
      </div>

      <BranchPicker
        data-slot="aui_user-branch-picker"
        className="col-span-full col-start-1 row-start-3 -me-1 justify-end"
      />
    </MessagePrimitive.Root>
  )
}

const UserActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-user-action-bar-root flex flex-col items-end"
    >
      <ActionBarPrimitive.Edit
        render={
          <TooltipIconButton tooltip="Edit" className="aui-user-action-edit" />
        }
      >
        <PencilIcon />
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  )
}

const EditComposer: FC = () => {
  return (
    <MessagePrimitive.Root
      data-slot="aui_edit-composer-wrapper"
      className="flex flex-col px-2 [contain-intrinsic-size:auto_200px] [content-visibility:auto]"
    >
      <ComposerPrimitive.Root className="aui-edit-composer-root ms-auto flex w-full max-w-[85%] flex-col rounded-(--composer-radius) border border-border/60 bg-(--composer-bg) shadow-[0_4px_16px_-8px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] dark:border-muted-foreground/15 dark:shadow-none">
        <ComposerPrimitive.Input
          className="aui-edit-composer-input min-h-14 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-base text-foreground outline-none"
          autoFocus
        />
        <div className="aui-edit-composer-footer mx-2.5 mb-2.5 flex items-center gap-1.5 self-end">
          <ComposerPrimitive.Cancel
            render={
              <Button
                variant="ghost"
                size="sm"
                className="h-8 rounded-full px-3.5"
              />
            }
          >
            Cancel
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send
            render={<Button size="sm" className="h-8 rounded-full px-3.5" />}
          >
            Update
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  )
}

const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({
  className,
  ...rest
}) => {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn(
        "aui-branch-picker-root -ms-2 me-2 inline-flex items-center text-xs text-muted-foreground",
        className
      )}
      {...rest}
    >
      <BranchPickerPrimitive.Previous
        render={<TooltipIconButton tooltip="Previous" />}
      >
        <ChevronLeftIcon />
      </BranchPickerPrimitive.Previous>
      <span className="aui-branch-picker-state font-medium">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next render={<TooltipIconButton tooltip="Next" />}>
        <ChevronRightIcon />
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  )
}
