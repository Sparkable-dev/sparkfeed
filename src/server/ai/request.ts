import { z } from "zod"
import type { UIMessage } from "ai"
import { EFFORT_IDS } from "@/config/ai-models"
import { AUTONOMY_IDS, DEFAULT_AUTONOMY } from "@/config/autonomy"
import { SKILL_IDS } from "@/config/skills"

/**
 * The accepted shape of a chat turn.
 *
 * `.strip()` is load-bearing, not tidiness. `AssistantChatTransport` forwards
 * the client's own `system` message and frontend tool declarations on every
 * request — a documented feature of the transport, and also a prompt-injection
 * surface: without stripping, a caller could POST their own system prompt and
 * displace every instruction the server sets. Our transport is written not to
 * send those fields; this is the half that does not depend on the client
 * behaving.
 *
 * `workspaceId` is absent for the same reason. The route this replaced read it
 * from the body and passed it into a tenancy filter, so any caller could name
 * someone else's workspace — and an empty string disabled the filter entirely.
 * Tenancy comes from the session, never the payload.
 *
 * Kept in its own module so the stripping behaviour can be tested without
 * standing up the route.
 */
export const ChatBody = z
  .object({
    /**
     * The conversation this turn belongs to, and the primary key the thread is
     * saved under. Bounded because it reaches the database — an id is an opaque
     * token here, never interpolated into anything, but an unbounded one is
     * still a free write of arbitrary length.
     */
    id: z.string().min(1).max(100).optional(),
    messages: z.array(z.custom<UIMessage>()).min(1),
    modelId: z.string().optional(),
    effort: z.enum(EFFORT_IDS).optional(),
    /**
     * Safe to accept from the client because it can only ever *narrow*: the
     * session's scopes are the ceiling, and this filters below them. A request
     * claiming "auto" gains nothing the session does not already permit — see
     * `allowedTools` in `src/server/tools/registry.ts`.
     */
    autonomy: z.enum(AUTONOMY_IDS).default(DEFAULT_AUTONOMY),
    /**
     * Which skill this message invokes, if any. An *id*, never the instruction
     * text — the content is looked up server-side from `@/config/skills`, so a
     * caller cannot post their own procedure and have it treated as system
     * guidance. Same reasoning as the model allowlist.
     */
    skillId: z.enum(SKILL_IDS).optional(),
  })
  .strip()

export type ChatBody = z.infer<typeof ChatBody>
