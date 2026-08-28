import { randomUUID } from "node:crypto"
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { invalidArgument, notFound } from "./errors"
import type { UIMessage } from "ai"
import { db } from "@/db"
import { chatMessages, chatThreads } from "@/db/schema"

/**
 * Saved conversations.
 *
 * Deliberately not built on `ApiPrincipal` like the rest of the services layer.
 * That type describes an API key, and a key has no user — but a chat belongs to
 * a person, not to a workspace. Taking the owner explicitly means the ownership
 * rule is visible at every call site rather than buried in a translation.
 */

export interface ChatOwner {
  userId: string | null
  workspaceId: string | null
}

/**
 * A message on its way to the browser.
 *
 * Not `UIMessage`. TanStack checks a server function's return type is
 * serializable, and `UIMessage` carries `metadata: unknown`, which fails that
 * check — `unknown` could be a function or a stream for all the type system
 * knows. `parts` is `any` for the same reason and it is also the truth: the
 * part union belongs to the AI SDK, changes between versions, and this layer
 * stores it opaquely rather than claiming to understand it. The client casts
 * back when handing the list to the runtime.
 */
export interface StoredMessage {
  id: string
  role: string
  parts: Array<any>
}

export interface ThreadSummary {
  id: string
  title: string
  /** First line of the opening exchange, for the second row in the list. */
  preview: string
  updatedAt: string
  messageCount: number
}

/** Longest a derived title gets before it stops being a title. */
const TITLE_MAX = 70

/**
 * Every query is filtered by *both* columns.
 *
 * Not defence in depth for its own sake: `workspaceId` is nullable throughout
 * this schema, and `eq(col, null)` in SQL is never true — it silently matches
 * nothing. So the null case needs `isNull`, and writing that out once here is
 * what stops a later query quietly returning an empty list for every personal
 * workspace.
 */
function ownedBy(owner: ChatOwner) {
  if (!owner.userId) return null
  return and(
    eq(chatThreads.userId, owner.userId),
    owner.workspaceId
      ? eq(chatThreads.workspaceId, owner.workspaceId)
      : isNull(chatThreads.workspaceId)
  )
}

/** Server-side twin of `newChatId` in `@/lib/chat-id`, for a turn that arrived without one. */
export function newThreadId(): string {
  return `cht_${randomUUID().replace(/-/g, "").slice(0, 20)}`
}

/**
 * The plain text of a message, for search and for the list preview.
 *
 * Only `text` parts. A conversation's tool arguments and results are full of
 * urls, ids and JSON that would match almost any query and tell the reader
 * nothing about what the chat was for.
 */
export function messageText(message: UIMessage): string {
  return (message.parts ?? [])
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
}

/** A title from the opening question, which is what the person actually asked. */
export function deriveTitle(messages: Array<UIMessage>): string {
  const first = messages.find((m) => m.role === "user")
  const text = first ? messageText(first) : ""
  if (!text) return "New chat"
  // Cut on a word boundary — a title ending mid-word reads as a rendering bug.
  if (text.length <= TITLE_MAX) return text
  const cut = text.slice(0, TITLE_MAX)
  const lastSpace = cut.lastIndexOf(" ")
  return `${lastSpace > 40 ? cut.slice(0, lastSpace) : cut}…`
}

export async function listThreads(
  owner: ChatOwner,
  args: { limit?: number; query?: string } = {}
): Promise<Array<ThreadSummary>> {
  const scope = ownedBy(owner)
  if (!scope) return []

  const limit = Math.min(Math.max(args.limit ?? 50, 1), 200)
  const rows = await db
    .select({
      id: chatThreads.id,
      title: chatThreads.title,
      updatedAt: chatThreads.updatedAt,
    })
    .from(chatThreads)
    .where(and(scope, isNull(chatThreads.archivedAt)))
    .orderBy(desc(chatThreads.updatedAt))
    .limit(limit)

  if (rows.length === 0) return []

  /*
    Previews and counts in one grouped query rather than one per thread. The
    sidebar renders every thread at once, so the per-row version is an N+1 that
    grows with how much someone uses the product.
  */
  const ids = rows.map((r) => r.id)
  const stats = await db
    .select({
      threadId: chatMessages.threadId,
      messageCount: sql<number>`count(*)`.as("message_count"),
      preview: sql<string>`min(${chatMessages.searchText})`.as("preview"),
    })
    .from(chatMessages)
    .where(inArray(chatMessages.threadId, ids))
    .groupBy(chatMessages.threadId)

  const byThread = new Map(stats.map((s) => [s.threadId, s]))

  const summaries = rows.map((row) => {
    const stat = byThread.get(row.id)
    return {
      id: row.id,
      title: row.title,
      preview: (stat?.preview ?? "").slice(0, 140),
      updatedAt: row.updatedAt ?? "",
      messageCount: Number(stat?.messageCount ?? 0),
    }
  })

  if (!args.query?.trim()) return summaries

  // Filtered in memory on purpose. The list is capped at 200 rows, and a LIKE
  // across a text column would still need the same case-folding to behave the
  // same way on SQLite and Postgres.
  const needle = args.query.trim().toLowerCase()
  return summaries.filter(
    (t) =>
      t.title.toLowerCase().includes(needle) ||
      t.preview.toLowerCase().includes(needle)
  )
}

export async function getThread(
  owner: ChatOwner,
  threadId: string
): Promise<{ id: string; title: string; messages: Array<StoredMessage> }> {
  const scope = ownedBy(owner)
  if (!scope) throw notFound("Chat")

  const [thread] = await db
    .select()
    .from(chatThreads)
    .where(and(scope, eq(chatThreads.id, threadId)))
    .limit(1)

  // A thread belonging to someone else is "not found", not "forbidden" —
  // telling them apart confirms which ids exist.
  if (!thread) throw notFound("Chat")

  const rows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.threadId, threadId))
    .orderBy(chatMessages.seq)

  return {
    id: thread.id,
    title: thread.title,
    messages: rows.flatMap((row) => {
      /*
        A row that will not parse is dropped, not thrown on. `parts` is written
        by whatever version of the app was running at the time; one message
        stored by a future format should cost that message, not the whole
        conversation and the page around it.
      */
      try {
        return [{ id: row.id, role: row.role, parts: JSON.parse(row.parts) }]
      } catch {
        return []
      }
    }),
  }
}

/**
 * Write the conversation as it now stands.
 *
 * Delete-then-insert rather than an upsert per message. A turn can be *edited*
 * or *regenerated*, which rewrites the tail of the thread — an upsert would
 * leave the messages that no longer exist behind, and the next load would
 * replay a branch the user abandoned. A conversation is small enough that
 * replacing it whole is cheaper than being clever.
 */
export async function saveThread(
  owner: ChatOwner,
  args: { threadId: string; messages: Array<UIMessage>; title?: string }
): Promise<{ id: string; title: string }> {
  if (!owner.userId) throw invalidArgument("Chats need a signed-in user.")
  if (args.messages.length === 0) throw invalidArgument("Nothing to save.")

  const now = new Date().toISOString()
  const title = args.title?.trim() || deriveTitle(args.messages)

  const scope = ownedBy(owner)
  const [existing] = scope
    ? await db
        .select({ id: chatThreads.id, title: chatThreads.title })
        .from(chatThreads)
        .where(and(scope, eq(chatThreads.id, args.threadId)))
        .limit(1)
    : []

  if (existing) {
    await db
      .update(chatThreads)
      // The title is only derived once. Re-deriving on every save would
      // overwrite a title the user had renamed.
      .set({ updatedAt: now })
      .where(eq(chatThreads.id, args.threadId))
  } else {
    await db.insert(chatThreads).values({
      id: args.threadId,
      workspaceId: owner.workspaceId,
      userId: owner.userId,
      title,
      createdAt: now,
      updatedAt: now,
    })
  }

  await db.delete(chatMessages).where(eq(chatMessages.threadId, args.threadId))

  await db.insert(chatMessages).values(
    args.messages.map((message, index) => ({
      // The AI SDK's own id, which is random and stable across a reload. The
      // fallback only matters for a message that arrived without one.
      id: message.id || `${args.threadId}-${index}`,
      threadId: args.threadId,
      seq: index,
      role: message.role,
      parts: JSON.stringify(message.parts ?? []),
      searchText: messageText(message).slice(0, 2000),
      createdAt: now,
    }))
  )

  return { id: args.threadId, title: existing?.title ?? title }
}

export async function renameThread(
  owner: ChatOwner,
  args: { threadId: string; title: string }
): Promise<{ id: string; title: string }> {
  const scope = ownedBy(owner)
  if (!scope) throw notFound("Chat")

  const title = args.title.trim()
  if (!title) throw invalidArgument("A chat needs a title.")

  const [row] = await db
    .select({ id: chatThreads.id })
    .from(chatThreads)
    .where(and(scope, eq(chatThreads.id, args.threadId)))
    .limit(1)
  if (!row) throw notFound("Chat")

  await db
    .update(chatThreads)
    .set({ title: title.slice(0, 200) })
    .where(eq(chatThreads.id, args.threadId))

  return { id: args.threadId, title: title.slice(0, 200) }
}

/**
 * Really deleted, not archived.
 *
 * The messages go first: `chat_messages.thread_id` has a foreign key with no
 * cascade, matching the rest of this schema, so the other order fails on
 * Postgres and silently orphans every message on SQLite.
 */
export async function deleteThread(
  owner: ChatOwner,
  threadId: string
): Promise<{ id: string }> {
  const scope = ownedBy(owner)
  if (!scope) throw notFound("Chat")

  const [row] = await db
    .select({ id: chatThreads.id })
    .from(chatThreads)
    .where(and(scope, eq(chatThreads.id, threadId)))
    .limit(1)
  if (!row) throw notFound("Chat")

  await db.delete(chatMessages).where(eq(chatMessages.threadId, threadId))
  await db.delete(chatThreads).where(eq(chatThreads.id, threadId))

  return { id: threadId }
}
