import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { applySourceOrder } from "./services/source-order"
import { FOLDER_ORDER } from "./services/ordering"
import { folderInWorkspace } from "./services/tenancy"
import { resolveWorkspaceId } from "./services/context"
import type { SourceOrderResult } from "./services/source-order"
import { db } from "@/db/index"
import { folders } from "@/db/schema"
import { DEMO_MODE } from "@/lib/demo"

/**
 * The `/sources` page's one mutation.
 *
 * Thin on purpose — validation, tenancy and the demo gate live here, and the
 * work lives in `services/source-order.ts` where it can be tested against a
 * real database. Same split as `deleteFolder` and `deleteFolderTree`.
 */

/**
 * Not `z.uuid()`. Demo ids are hand-written strings like "demo-feed-openai"
 * (see `src/config/demo-feeds.json`), so a UUID constraint would reject the
 * entire demo workspace.
 */
const sourceId = z.string().min(1).max(64)

const saveSourceOrderInput = z
  .object({
    folders: z.array(sourceId).max(500),
    feeds: z.array(z.object({ id: sourceId, folderId: sourceId.nullable() })).max(2000),
  })
  .superRefine((value, ctx) => {
    if (new Set(value.folders).size !== value.folders.length) {
      ctx.addIssue({ code: "custom", message: "Duplicate folder id" })
    }
    const feedIds = value.feeds.map((f) => f.id)
    if (new Set(feedIds).size !== feedIds.length) {
      ctx.addIssue({ code: "custom", message: "Duplicate feed id" })
    }
  })

export type SaveSourceOrderResult = SourceOrderResult | { status: "demo_locked" }

export const saveSourceOrder = createServerFn({ method: "POST" })
  .validator((d: unknown) => saveSourceOrderInput.parse(d))
  .handler(async ({ data }): Promise<SaveSourceOrderResult> => {
    // A typed result rather than a throw, following `updateFeed`: the client
    // branches on the outcome to choose between reverting and refetching.
    if (DEMO_MODE) return { status: "demo_locked" }

    const workspaceId = await resolveWorkspaceId()
    return await applySourceOrder(db, workspaceId, data)
  })

/**
 * Folder names and ids, and nothing else.
 *
 * `getAllData` already returns folders, but it returns every article with them
 * — fine for a page load, absurd for a dropdown on one card in a chat
 * transcript. This is the query that was missing rather than a second source of
 * truth: it reads the same table, workspace-scoped, in the same order the
 * sidebar uses.
 */
export const listFolderOptions = createServerFn({ method: "GET" }).handler(
  async (): Promise<Array<{ id: string; name: string }>> => {
    const workspaceId = await resolveWorkspaceId()
    return await db
      .select({ id: folders.id, name: folders.name })
      .from(folders)
      .where(folderInWorkspace(workspaceId))
      .orderBy(...FOLDER_ORDER)
  }
)
