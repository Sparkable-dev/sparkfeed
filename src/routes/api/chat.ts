import { createFileRoute } from "@tanstack/react-router"
import { resolveWorkspaceContextFromHeaders } from "@/server/services/context"
import { buildChatStream } from "@/server/ai/chat"
import { aiDisabled, isDemo } from "@/server/ai/env"
import { principalFromWorkspaceContext } from "@/server/ai/principal"
import {
  AI_BAD_REQUEST,
  AI_DISABLED,
  AI_UNAUTHENTICATED,
  toUserFacingError,
} from "@/server/ai/errors"
import { ChatBody } from "@/server/ai/request"
import { newThreadId, saveThread } from "@/server/services/chats"

function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        try {
          // Demo deployments render the full chat UI but must never reach a
          // model — the composer blocks sending client-side, and this is the
          // gate that does not depend on the client.
          if (aiDisabled()) throw AI_DISABLED(isDemo())

          // File-route handlers run outside the ambient request store, so headers
          // must be passed explicitly rather than via getRequestHeaders().
          const context = await resolveWorkspaceContextFromHeaders(
            request.headers
          )
          if (!context.workspaceId) throw AI_UNAUTHENTICATED()

          const parsed = ChatBody.safeParse(await request.json())
          if (!parsed.success) throw AI_BAD_REQUEST()

          // The services layer speaks `ApiPrincipal`, so the session is
          // translated into one here. Tenancy comes from the session's
          // workspace and nothing else — the body cannot influence it.
          const principal = principalFromWorkspaceContext(context)

          const result = await buildChatStream(principal, {
            messages: parsed.data.messages,
            modelId: parsed.data.modelId,
            effort: parsed.data.effort,
            autonomy: parsed.data.autonomy,
            skillId: parsed.data.skillId,
          })

          /*
            Consume the stream regardless of whether the client is still
            listening. `streamText` applies backpressure to the provider, so a
            closed tab aborts the run mid-answer and `onEnd` never fires —
            leaving a conversation saved without the reply the user watched
            arrive. Not awaited: the response has to be returned now.
          */
          result.consumeStream()

          return result.toUIMessageStreamResponse({
            sendReasoning: true,
            // Without this the SDK masks every mid-stream failure as
            // "An error occurred." and the UI has nothing to show.
            onError: (error) => toUserFacingError(error).message,
            // `onEnd` is handed the whole conversation, the new reply included,
            // only when it knows what came before it.
            originalMessages: parsed.data.messages,
            onEnd: ({ messages }) => {
              /*
                Saving is best-effort and deliberately not awaited into the
                response. Persistence is an addition to the chat, not a
                precondition for it: a failing write should cost the user their
                history, which they can see, rather than their answer, which
                they are in the middle of reading.
              */
              void saveThread(context, {
                threadId: parsed.data.id ?? newThreadId(),
                messages,
              }).catch((error) => {
                console.error("[chat] could not save the thread:", error)
              })
            },
          })
        } catch (error) {
          const { status, message } = toUserFacingError(error)
          return errorResponse(status, message)
        }
      },
    },
  },
})
