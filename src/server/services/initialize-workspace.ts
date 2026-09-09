import type { Database } from "@/db/client"
import { folders } from "@/db/schema"
import { db } from "@/db/index"

/** Called at workspace creation, never by GET loaders or link prefetches. */
export async function initializeWorkspace(
  workspaceId: string,
  database: Pick<Database, "insert"> = db
) {
  await database
    .insert(folders)
    .values({ id: `initial-${workspaceId}`, workspaceId, name: "General" })
    .onConflictDoNothing()
}
