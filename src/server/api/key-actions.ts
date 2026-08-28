import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { resolveWorkspaceContext } from "../services/context"
import { listApiKeys, mintApiKey, revokeApiKey } from "./keys"
import { DEFAULT_SCOPES, isScope } from "./principal"
import type { Scope } from "./principal"
import { DEMO_MODE } from "@/lib/demo"

/**
 * Server functions backing the Developer > API keys page.
 *
 * `workspaceId` is always derived from the session here and never accepted from
 * the client. That is the whole security model for key minting: a client that
 * could name the workspace could mint itself a key into someone else's.
 *
 * Note these are written out individually rather than generated from a helper.
 * `createServerFn().handler()` is a build-time transform keyed to each
 * syntactic occurrence; a factory produces one occurrence and the handler ends
 * up shipped to the browser instead of becoming an RPC stub.
 */

const DEMO_MSG =
  "API keys cannot be created in demo mode. The demo MCP endpoint uses a shared public key."

async function requireWorkspace() {
  const ctx = await resolveWorkspaceContext()
  if (!ctx.workspaceId) throw new Error("Unauthorized")
  return ctx
}

export const listKeys = createServerFn({ method: "GET" }).handler(async () => {
  if (DEMO_MODE) return { keys: [], demo: true as const }
  const { workspaceId } = await requireWorkspace()
  return { keys: await listApiKeys(workspaceId!), demo: false as const }
})

export const createKey = createServerFn({ method: "POST" })
  .validator((d: any) =>
    z
      .object({
        name: z.string().min(1, "Give the key a name").max(80),
        scopes: z.array(z.string()).optional(),
      })
      .parse(d)
  )
  .handler(async ({ data }) => {
    if (DEMO_MODE) throw new Error(DEMO_MSG)
    const { workspaceId, userId } = await requireWorkspace()

    // Unknown scope strings are dropped rather than rejected, so a stale client
    // asking for a scope we removed still gets a usable key.
    const requested = (data.scopes ?? []).filter((s): s is Scope => isScope(s))

    return mintApiKey({
      workspaceId: workspaceId!,
      userId,
      name: data.name.trim(),
      scopes: requested.length ? requested : DEFAULT_SCOPES,
    })
  })

export const deleteKey = createServerFn({ method: "POST" })
  .validator((d: any) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data }) => {
    if (DEMO_MODE) throw new Error(DEMO_MSG)
    const { workspaceId } = await requireWorkspace()
    const ok = await revokeApiKey(workspaceId!, data.id)
    if (!ok) throw new Error("Key not found")
    return { revoked: true }
  })
