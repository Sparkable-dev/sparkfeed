import * as React from "react"
import { XIcon } from "lucide-react"
import { AssistantRuntimeProvider, AuiConfig, Tools } from "@assistant-ui/react"
import {
  AssistantChatTransport,
  useChatRuntime,
} from "@assistant-ui/react-ai-sdk"
import { Thread } from "@/components/assistant-ui/thread"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { sparkToolkit } from "@/components/ai/tools/toolkit"
import { ArtifactPanel } from "@/components/ai/artifacts/ArtifactPanel"
import { AssetsDock } from "@/components/ai/artifacts/AssetsDock"
import {
  ArtifactProvider,
  useArtifactPanel,
} from "@/components/ai/artifacts/artifact-context"
import { useAIComposerPrefs } from "@/store/aiComposerPrefs"
import { notifyChatSaved } from "@/components/ai/history/use-chat-history"
import { getSparkAiCreditSummary } from "@/server/ai-credit-actions"
import { SparkAiCreditContext } from "@/components/ai/credit-context"

/**
 * Root of the Spark AI page. Client-only — `useChatRuntime` wraps `useChat`,
 * which cannot render on the server. The route mounts this inside `ClientOnly`.
 *
 * `threadId` is both the URL segment and the primary key the conversation is
 * saved under, so a reload restores exactly what was on screen. That includes
 * artifacts, with nothing extra: `create_artifact` carries the document in its
 * tool call's arguments, the arguments are part of the stored message, and
 * `ArtifactCard` renders from them either way.
 */
export function SparkChat({
  threadId,
  initialMessages,
  initialCreditBalance,
}: {
  threadId: string
  initialMessages: Array<{ id: string; role: string; parts: Array<unknown> }>
  initialCreditBalance: number | null
}) {
  const [error, setError] = React.useState<string | null>(null)
  const [balance, setBalance] = React.useState(initialCreditBalance)
  const [refreshing, setRefreshing] = React.useState(false)
  const refreshBalance = React.useCallback(async () => {
    if (initialCreditBalance === null) return
    setRefreshing(true)
    try {
      const summary = await getSparkAiCreditSummary()
      setBalance(summary.balance)
    } finally {
      setRefreshing(false)
    }
  }, [initialCreditBalance])

  // Read through a ref so changing model or effort mid-conversation does not
  // rebuild the transport (which would tear down an in-flight stream). The
  // transport is created once; each request reads the current values.
  const prefs = useAIComposerPrefs()
  const prefsRef = React.useRef(prefs)
  prefsRef.current = prefs

  const transport = React.useMemo(
    () =>
      new AssistantChatTransport({
        api: "/api/chat",
        // Returning a body replaces the transport's default one entirely, which
        // is what we want: its default injects the client's `system` prompt and
        // tool declarations, and neither belongs in a request the server trusts.
        // The server strips them too — this is just the near half of that.
        prepareSendMessagesRequest: ({ messages, trigger, messageId }) => {
          const currentPrefs = prefsRef.current
          const skillId = currentPrefs.activeSkillId

          // Consume the skill here rather than in the composer: this callback
          // fires exactly once per send, so the chip clears when the message
          // actually goes, and a send that never happens keeps it pinned.
          if (skillId) currentPrefs.setActiveSkill(null)

          return {
            body: {
              /*
                The URL's id, not the one this callback is handed.

                `useChatRuntime` is built on `useRemoteThreadListRuntime`, which
                mints its own per-tab thread id (`__LOCALID_…`) and overrides the
                `id` we pass to the runtime with it. That id was reaching the
                server and the conversation was being saved under it, so the
                sidebar linked to `/dashboard/ai/__LOCALID_…` — an id the route
                rejects, which is where "Not Found" on reopening a tab came from.

                The id in the address bar is the one the thread has to be saved
                under, because it is the one a reload asks for.
              */
              id: threadId,
              messages,
              trigger,
              messageId,
              modelId: currentPrefs.modelId,
              ...(currentPrefs.effort ? { effort: currentPrefs.effort } : {}),
              // Narrows which tools the server offers this turn. It can only
              // restrict — the session's scopes are the ceiling.
              autonomy: currentPrefs.autonomy,
              // An id only; the server looks the instructions up from its own
              // catalogue, so the client cannot supply system guidance.
              ...(skillId ? { skillId } : {}),
            },
          }
        },
      }),
    [threadId]
  )

  // Note: `useChatRuntime` accepts `suggestions` and `isSendDisabled` in its
  // type but discards both in its implementation, so neither is used here.
  // Starter prompts live in StarterPrompts.tsx; demo mode is enforced in the
  // composer and, authoritatively, on the server.
  const runtime = useChatRuntime({
    // The id travels to the server on every turn as `body.id`, which is what
    // the save keys on. Without it each turn would be filed under a new thread.
    id: threadId,
    messages: initialMessages as never,
    transport,
    onError: (err) => {
      setError(err.message || "Spark AI could not respond.")
      void refreshBalance()
    },
    // The server saves the thread as the stream ends; this is what tells the
    // sidebar to look, so a brand new conversation appears in History without
    // having to navigate away and back.
    onFinish: () => {
      notifyChatSaved()
      void refreshBalance()
    },
  })

  // Clear a stale banner as soon as the next attempt starts.
  const handleClearError = React.useCallback(() => setError(null), [])

  // Render-only toolkit: the server owns every schema and executor, so this
  // just tells the thread how each tool's result should look. Tools without an
  // entry fall through to ToolFallback.
  const config = React.useMemo(
    () => AuiConfig({ tools: Tools({ toolkit: sparkToolkit }) }),
    []
  )

  return (
    <SparkAiCreditContext.Provider value={{ balance, refreshing }}>
      <AssistantRuntimeProvider runtime={runtime} config={config}>
        <ArtifactProvider threadId={threadId}>
          <ChatSurface error={error} onClearError={handleClearError} />
        </ArtifactProvider>
      </AssistantRuntimeProvider>
    </SparkAiCreditContext.Provider>
  )
}

/**
 * Thread and document panel, side by side.
 *
 * Split out from `SparkChat` only because it has to read the artifact context,
 * which the provider above it owns. When a document is open the thread keeps a
 * fixed, readable column rather than shrinking to whatever is left — a chat
 * squeezed to 300px is not a chat — and on a phone the panel covers it outright.
 */
function ChatSurface({
  error,
  onClearError,
}: {
  error: string | null
  onClearError: () => void
}) {
  const panel = useArtifactPanel()
  const open = Boolean(panel?.artifact)

  return (
    <div className="flex h-full min-h-0">
      <div
        className={
          open
            ? "hidden min-w-0 flex-col md:flex md:w-[26rem] md:shrink-0 lg:w-[32rem]"
            : "flex min-w-0 flex-1 flex-col"
        }
      >
        {error ? (
          <div className="shrink-0 px-4 pt-3">
            <Alert
              variant="destructive"
              className="mx-auto max-w-(--thread-max-width)"
            >
              <AlertTitle>Spark AI could not respond</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-2 right-2 size-6"
                onClick={onClearError}
                aria-label="Dismiss error"
              >
                <XIcon className="size-3.5" />
              </Button>
            </Alert>
          </div>
        ) : null}

        {/*
          The dock floats over the thread's top-right corner rather than sitting
          in a bar of its own. There is no toolbar here to put it in, and adding
          one for a single button would cost every conversation a strip of
          height for something most of them never produce — the dock renders
          nothing at all until this chat has made something.
        */}
        <div className="relative min-h-0 flex-1">
          <Thread />
          <div className="pointer-events-none absolute end-3 top-3 z-20 flex justify-end">
            <div className="pointer-events-auto">
              <AssetsDock />
            </div>
          </div>
        </div>
      </div>

      {/*
        Renders nothing until something is open. The wrapper must be `flex`, not
        just `flex-1`: the panel is a plain block child otherwise, so it takes
        its content's height and a short document leaves the column half empty
        with the background showing through beneath it.
      */}
      <div className={open ? "flex min-w-0 flex-1" : "contents"}>
        <ArtifactPanel />
      </div>
    </div>
  )
}
