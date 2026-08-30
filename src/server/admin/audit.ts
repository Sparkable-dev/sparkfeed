import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import { redactAuditValue, requireAuditReason } from "./audit-values"
import { db } from "@/db/index"
import { platformAdminAuditLog } from "@/db/schema"

export { redactAuditValue, requireAuditReason } from "./audit-values"

function serialize(value: unknown): string | null {
  if (value === undefined) return null
  return JSON.stringify(redactAuditValue(value))
}

export async function startAdminAudit(input: {
  actorUserId: string
  action: string
  targetType: string
  targetId: string
  reason: string
  beforeState?: unknown
}): Promise<string> {
  const id = randomUUID()
  await db.insert(platformAdminAuditLog).values({
    id,
    actorUserId: input.actorUserId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    reason: requireAuditReason(input.reason),
    beforeState: serialize(input.beforeState),
    afterState: serialize({ status: "started" }),
    createdAt: new Date().toISOString(),
  })
  return id
}

export async function finishAdminAudit(
  id: string,
  afterState: unknown
): Promise<void> {
  await db
    .update(platformAdminAuditLog)
    .set({ afterState: serialize(afterState) })
    .where(eq(platformAdminAuditLog.id, id))
}

export async function failAdminAudit(
  id: string,
  error: unknown
): Promise<void> {
  await finishAdminAudit(id, {
    status: "failed",
    error: error instanceof Error ? error.message : "Unknown error",
  })
}
