import { and, eq } from "drizzle-orm"
import { feedInWorkspace, folderInWorkspace } from "./tenancy"
import { resolveWorkspaceId } from "./context"
import { feeds, folders } from "@/db/schema"
import { db } from "@/db/index"

/**
 * Confirms a row is owned by the caller's workspace before a mutation touches
 * it. Returns the workspace id so callers can keep using it.
 *
 * Deliberately throws the same message whether the row is missing or belongs to
 * someone else: distinguishing the two leaks which ids exist.
 *
 * Lives here rather than inside `rss.ts` because the share API routes need it
 * too. They shipped with a session check but no ownership check, which meant
 * any signed-in user could toggle sharing on anyone's folder by posting its id.
 */
export const NOT_FOUND_MSG = "Not found"

export async function assertOwnsFeed(
  feedId: string,
  workspaceId?: string | null,
): Promise<string | null> {
  const ws = workspaceId !== undefined ? workspaceId : await resolveWorkspaceId()
  const [row] = await db
    .select({ id: feeds.id })
    .from(feeds)
    .where(and(eq(feeds.id, feedId), feedInWorkspace(ws)))
    .limit(1)
  if (!row) throw new Error(NOT_FOUND_MSG)
  return ws
}

export async function assertOwnsFolder(
  folderId: string,
  workspaceId?: string | null,
): Promise<string | null> {
  const ws = workspaceId !== undefined ? workspaceId : await resolveWorkspaceId()
  const [row] = await db
    .select({ id: folders.id })
    .from(folders)
    .where(and(eq(folders.id, folderId), folderInWorkspace(ws)))
    .limit(1)
  if (!row) throw new Error(NOT_FOUND_MSG)
  return ws
}

/** Non-throwing variant, for read paths that branch on ownership. */
export async function ownsFolder(
  folderId: string,
  workspaceId: string | null,
): Promise<boolean> {
  const [row] = await db
    .select({ id: folders.id })
    .from(folders)
    .where(and(eq(folders.id, folderId), folderInWorkspace(workspaceId)))
    .limit(1)
  return !!row
}
