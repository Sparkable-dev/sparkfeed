import { eq } from "drizzle-orm"
import type { WorkspaceRef } from "./types"
import { db } from "@/db/index"
import { organization } from "@/db/schema"
import {
  organizationWorkspaceRef,
  personalWorkspaceRef,
} from "@/lib/workspaces"

export async function workspaceRefFromId(
  workspaceId: string
): Promise<WorkspaceRef> {
  const [row] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, workspaceId))
    .limit(1)

  return row
    ? organizationWorkspaceRef(workspaceId)
    : personalWorkspaceRef(workspaceId)
}
