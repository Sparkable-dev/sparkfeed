import { beforeEach, describe, expect, it, vi } from "vitest"
import type { createClient } from "@libsql/client"
import type { Database } from "@/db/client"
import type { UIMessage } from "ai"
import { createDb } from "@/db/client"

/**
 * Chat history, against a real database.
 *
 * SQLite for the same reason `tools.db.test.ts` uses it: demo mode runs these
 * Postgres table objects through libsql, so anything Postgres-only would pass
 * in production and break only on the public demo.
 */

let db: Database

vi.mock("@/db/index", () => ({
  get db() {
    return db
  },
}))

const {
  deleteThread,
  deriveTitle,
  getThread,
  listThreads,
  renameThread,
  saveThread,
} = await import("../chats")

const ALICE = { userId: "user-alice", workspaceId: "ws-1" }
const BOB = { userId: "user-bob", workspaceId: "ws-1" }
/** A solo user has no organization, so `workspace_id` is null. */
const SOLO = { userId: "user-solo", workspaceId: null }

beforeEach(async () => {
  db = createDb(":memory:", { sqlite: true })
  const raw = (db as unknown as { $client: ReturnType<typeof createClient> })
    .$client

  await raw.execute(`CREATE TABLE chat_threads (
    id TEXT PRIMARY KEY, workspace_id TEXT, user_id TEXT NOT NULL,
    title TEXT NOT NULL, created_at TEXT, updated_at TEXT, archived_at TEXT)`)
  await raw.execute(`CREATE TABLE chat_messages (
    id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, seq INTEGER NOT NULL,
    role TEXT NOT NULL, parts TEXT NOT NULL,
    search_text TEXT NOT NULL DEFAULT '', created_at TEXT)`)
})

const userMessage = (id: string, text: string): UIMessage =>
  ({ id, role: "user", parts: [{ type: "text", text }] })

const assistantMessage = (id: string, text: string): UIMessage =>
  ({ id, role: "assistant", parts: [{ type: "text", text }] })

describe("saving and loading", () => {
  it("brings a conversation back exactly as it was", async () => {
    await saveThread(ALICE, {
      threadId: "cht_1",
      messages: [
        userMessage("m1", "What is unread?"),
        assistantMessage("m2", "Twelve articles."),
      ],
    })

    const loaded = await getThread(ALICE, "cht_1")
    expect(loaded.messages).toHaveLength(2)
    expect(loaded.messages[0]?.role).toBe("user")
    expect(loaded.messages[1]?.parts[0]).toEqual({
      type: "text",
      text: "Twelve articles.",
    })
  })

  it("keeps an artifact whole across a reload", async () => {
    /*
      The reason `parts` is stored verbatim rather than flattened to text.

      An artifact is not a separate record — the document lives in the
      arguments of a `create_artifact` tool call, and `ArtifactCard` renders
      from those arguments whether they arrived over the wire or out of this
      table. Lose the arguments and a reloaded chat shows a card that opens an
      empty panel.
    */
    const document = "# Weekly digest\n\n- one\n- two\n"
    const withArtifact = {
      id: "m2",
      role: "assistant",
      parts: [
        {
          type: "tool-create_artifact",
          toolCallId: "call_1",
          state: "output-available",
          input: {
            title: "Weekly digest",
            kind: "markdown",
            content: document,
          },
          output: { kind: "markdown", title: "Weekly digest", lines: 4 },
        },
        { type: "text", text: "Opened it in the panel." },
      ],
    } as unknown as UIMessage

    await saveThread(ALICE, {
      threadId: "cht_art",
      messages: [userMessage("m1", "Write me a digest"), withArtifact],
    })

    const loaded = await getThread(ALICE, "cht_art")
    const part = loaded.messages[1]?.parts[0]
    expect(part.type).toBe("tool-create_artifact")
    expect(part.input.content).toBe(document)
    expect(part.state).toBe("output-available")
  })

  it("replaces the thread rather than appending to it", async () => {
    // Regenerating a turn shortens the conversation. An upsert would leave the
    // abandoned tail behind and replay a branch the user threw away.
    await saveThread(ALICE, {
      threadId: "cht_2",
      messages: [
        userMessage("m1", "a"),
        assistantMessage("m2", "b"),
        userMessage("m3", "c"),
      ],
    })
    await saveThread(ALICE, {
      threadId: "cht_2",
      messages: [userMessage("m1", "a"), assistantMessage("m2", "b-again")],
    })

    const loaded = await getThread(ALICE, "cht_2")
    expect(loaded.messages).toHaveLength(2)
    expect(loaded.messages[1]?.parts[0].text).toBe("b-again")
  })

  it("survives a message it cannot parse", async () => {
    await saveThread(ALICE, {
      threadId: "cht_3",
      messages: [userMessage("m1", "a"), assistantMessage("m2", "b")],
    })
    const raw = (db as unknown as { $client: ReturnType<typeof createClient> })
      .$client
    await raw.execute(`UPDATE chat_messages SET parts = 'not json' WHERE id = 'm1'`)

    // One unreadable row costs that message, not the conversation.
    const loaded = await getThread(ALICE, "cht_3")
    expect(loaded.messages).toHaveLength(1)
    expect(loaded.messages[0]?.id).toBe("m2")
  })
})

describe("a chat belongs to one person", () => {
  it("hides another user's thread in the same workspace", async () => {
    await saveThread(ALICE, {
      threadId: "cht_a",
      messages: [userMessage("m1", "something private")],
    })

    // Not "forbidden" — telling the two apart would confirm the id exists.
    await expect(getThread(BOB, "cht_a")).rejects.toThrow(/not found/i)
    expect(await listThreads(BOB)).toEqual([])
  })

  it("will not let another user rename or delete it", async () => {
    await saveThread(ALICE, {
      threadId: "cht_a",
      messages: [userMessage("m1", "hello")],
    })

    await expect(
      renameThread(BOB, { threadId: "cht_a", title: "hijacked" })
    ).rejects.toThrow(/not found/i)
    await expect(deleteThread(BOB, "cht_a")).rejects.toThrow(/not found/i)

    const stillThere = await getThread(ALICE, "cht_a")
    expect(stillThere.title).toBe("hello")
  })

  it("finds a solo user's chats, whose workspace is null", async () => {
    /*
      The bug this exists to catch: `eq(column, null)` is never true in SQL, so
      a scope built without `isNull` returns an empty list for every user who
      has not created an organization — which is most of them.
    */
    await saveThread(SOLO, {
      threadId: "cht_solo",
      messages: [userMessage("m1", "my own workspace")],
    })

    const list = await listThreads(SOLO)
    expect(list).toHaveLength(1)
    expect(list[0]?.id).toBe("cht_solo")
  })
})

describe("the list", () => {
  it("puts the most recently used chat first, not the newest", async () => {
    await saveThread(ALICE, {
      threadId: "old",
      messages: [userMessage("m1", "first conversation")],
    })
    await saveThread(ALICE, {
      threadId: "new",
      messages: [userMessage("m2", "second conversation")],
    })
    // Returning to the older chat should lift it back to the top.
    await saveThread(ALICE, {
      threadId: "old",
      messages: [userMessage("m1", "first conversation"), assistantMessage("m3", "more")],
    })

    const list = await listThreads(ALICE)
    expect(list.map((t) => t.id)).toEqual(["old", "new"])
    expect(list[0]?.messageCount).toBe(2)
  })

  it("filters on what was said, not just the title", async () => {
    await saveThread(ALICE, {
      threadId: "cht_1",
      messages: [userMessage("m1", "Tell me about kubernetes operators")],
    })
    await saveThread(ALICE, {
      threadId: "cht_2",
      messages: [userMessage("m2", "Summarise my unread")],
    })

    expect((await listThreads(ALICE, { query: "kubernetes" }))).toHaveLength(1)
    expect((await listThreads(ALICE, { query: "KUBERNETES" }))).toHaveLength(1)
    expect(await listThreads(ALICE, { query: "postgres" })).toEqual([])
  })

  it("takes the messages with the thread when it is deleted", async () => {
    await saveThread(ALICE, {
      threadId: "cht_1",
      messages: [userMessage("m1", "a"), assistantMessage("m2", "b")],
    })
    await deleteThread(ALICE, "cht_1")

    const raw = (db as unknown as { $client: ReturnType<typeof createClient> })
      .$client
    const rows = await raw.execute("SELECT COUNT(*) AS n FROM chat_messages")
    expect(Number(rows.rows[0]?.n)).toBe(0)
  })
})

describe("titles", () => {
  it("uses the opening question, because that is what the chat was about", () => {
    expect(deriveTitle([userMessage("m1", "How many feeds do I have?")])).toBe(
      "How many feeds do I have?"
    )
  })

  it("cuts a long one on a word boundary", () => {
    const question =
      "I want to know what is happening with healthcare AI journals and scientific research, is there any RSS on this?"
    const title = deriveTitle([userMessage("m1", question)])

    expect(title.length).toBeLessThanOrEqual(72)
    expect(title.endsWith("…")).toBe(true)

    // The real property: whatever was kept is a whole prefix of the question,
    // and the next character in the original is a space. A title ending
    // mid-word reads as a rendering bug rather than as an ellipsis.
    const kept = title.slice(0, -1)
    expect(question.startsWith(kept)).toBe(true)
    expect(question[kept.length]).toBe(" ")
  })

  it("ignores an opening turn that carries no text", () => {
    expect(deriveTitle([assistantMessage("m1", "hi")])).toBe("New chat")
  })

  it("keeps a name the user chose", async () => {
    await saveThread(ALICE, {
      threadId: "cht_1",
      messages: [userMessage("m1", "original question")],
    })
    await renameThread(ALICE, { threadId: "cht_1", title: "Q3 research" })

    // The next turn must not re-derive over the top of it.
    await saveThread(ALICE, {
      threadId: "cht_1",
      messages: [userMessage("m1", "original question"), assistantMessage("m2", "b")],
    })

    expect((await getThread(ALICE, "cht_1")).title).toBe("Q3 research")
  })
})
