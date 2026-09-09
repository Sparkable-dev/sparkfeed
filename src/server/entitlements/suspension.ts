import { sparkfeedEdition } from "./config"
import { readEffectiveSubscription } from "./effective"
import { workspaceRefFromId } from "./workspace"
import { DEMO_MODE } from "@/lib/demo"
import { db } from "@/db/index"

/** Read-only check for browser content and public sharing, without credit grants. */
export async function workspaceIsSuspended(workspaceId: string | null) {
  if (!workspaceId || DEMO_MODE || sparkfeedEdition() !== "cloud") return false
  const workspace = await workspaceRefFromId(workspaceId)
  const effective = await readEffectiveSubscription(db, workspace)
  return effective?.accessState === "suspended"
}
