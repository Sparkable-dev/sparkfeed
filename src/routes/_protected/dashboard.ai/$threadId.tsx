import { ClientOnly, createFileRoute, notFound } from "@tanstack/react-router"
import { loadWorkspaceData } from "@/lib/workspace-query"
import { RSSShell } from "@/components/RSSShell"
import { SparkChat } from "@/components/ai/SparkChat"
import { Skeleton } from "@/components/ui/skeleton"
import { loadChat } from "@/server/chats"
import { isChatId } from "@/lib/chat-id"

export const Route = createFileRoute("/_protected/dashboard/ai/$threadId")({
  loader: async ({ params, context }) => {
    // Checked before the id reaches a query. `loadChat` treats an unknown id as
    // an empty chat, so without this a typo in the URL would silently open a
    // blank conversation that then saved itself under that name.
    if (!isChatId(params.threadId)) throw notFound()

    const [data, chat] = await Promise.all([
      loadWorkspaceData(context),
      loadChat({ data: { threadId: params.threadId } }),
    ])
    return { data, chat }
  },
  component: AIPage,
})

function AIPage() {
  const { data, chat } = Route.useLoaderData()

  return (
    <RSSShell
      initialData={{
        folders: data.folders,
        feeds: data.feeds,
        articles: data.articles,
      }}
      title="Spark AI"
    >
      {/*
        The chat takes an explicit height rather than relying on the shell.
        RSSShell gives its children no `overflow` on purpose — adding it there
        once turned the container into a scroll container and silently broke
        every `position: sticky` descendant in the app (see the note in
        RSSShell.tsx). Sizing to viewport-minus-topbar here keeps the document
        itself from scrolling, so the message list scrolls internally and the
        composer stays pinned. `svh` rather than `vh` so the iOS URL bar
        collapsing does not push the composer off-screen.
      */}
      <div className="flex h-[calc(100svh-3rem)] min-h-0 flex-col overflow-hidden">
        {/*
          Demo mode gets the real interface, not a lock screen. The whole point
          of the demo is to show what Spark AI looks like, and a placeholder card
          shows nothing. Sending is intercepted in the composer (and refused by
          the server), so the UI is fully explorable without reaching a model.

          useChatRuntime wraps useChat, which cannot render on the server.

          Keyed on the thread so switching conversations rebuilds the runtime
          rather than trying to swap a live `useChat` instance underneath it.
        */}
        <ClientOnly fallback={<ChatSkeleton />}>
          <SparkChat
            key={chat.id}
            threadId={chat.id}
            initialMessages={chat.messages}
          />
        </ClientOnly>
      </div>
    </RSSShell>
  )
}

/**
 * Occupies the same box as the real chat so nothing jumps on hydrate.
 */
function ChatSkeleton() {
  return (
    <div className="flex h-full flex-col justify-end gap-4 p-4">
      <div className="mx-auto w-full max-w-[44rem] space-y-3">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
      <div className="mx-auto w-full max-w-[44rem]">
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
    </div>
  )
}
