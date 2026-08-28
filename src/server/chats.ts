import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import {
  deleteThread,
  getThread,
  listThreads,
  renameThread,
} from "./services/chats"
import { resolveWorkspaceContext } from "./services/context"

/**
 * The chat history, for the app's own UI.
 *
 * Reads and management only. Writing a conversation happens in
 * `src/routes/api/chat.ts` at the end of the stream, where the finished message
 * list already exists — routing that through the client would mean trusting the
 * browser to report what the model said.
 *
 * There is no REST or MCP equivalent, and that is deliberate: `TOOL_REGISTRY`
 * is what a *model* may do to a workspace, and letting Spark AI read or delete
 * the user's other conversations with Spark AI is not a capability worth
 * having.
 */

const threadId = z.object({ threadId: z.string().min(1).max(100) })

export const listChats = createServerFn({ method: "GET" })
  .validator(
    z.object({ query: z.string().max(200).optional() }).optional().default({})
  )
  .handler(async ({ data }) => {
    const context = await resolveWorkspaceContext()
    return await listThreads(context, { query: data.query })
  })

/**
 * A thread's messages, or an empty thread.
 *
 * A missing row is the normal case, not an error: the AI page mints an id and
 * navigates to it before a word has been typed, so every new chat asks for a
 * thread that does not exist yet. Returning empty also means a guessed or
 * someone else's id looks exactly like a new chat — which is the right answer,
 * since distinguishing them would confirm the id exists.
 */
export const loadChat = createServerFn({ method: "GET" })
  .validator(threadId)
  .handler(async ({ data }) => {
    const context = await resolveWorkspaceContext()
    try {
      return await getThread(context, data.threadId)
    } catch {
      return { id: data.threadId, title: "New chat", messages: [] }
    }
  })

export const renameChat = createServerFn({ method: "POST" })
  .validator(threadId.extend({ title: z.string().min(1).max(200) }))
  .handler(async ({ data }) => {
    const context = await resolveWorkspaceContext()
    return await renameThread(context, data)
  })

export const deleteChat = createServerFn({ method: "POST" })
  .validator(threadId)
  .handler(async ({ data }) => {
    const context = await resolveWorkspaceContext()
    return await deleteThread(context, data.threadId)
  })
