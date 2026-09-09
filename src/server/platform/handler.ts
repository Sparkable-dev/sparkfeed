import { and, desc, eq, lt, sql } from "drizzle-orm"
import { APIError } from "better-auth/api"
import { ZodError } from "zod"
import {
  changeWorkspaceAccess,
  manageWorkspaceMember,
} from "./workspace-actions"
import { PlatformRequestError, verifyPlatformAssertion } from "./assertion"
import { listQuerySchema } from "./contracts"
import {
  platformOverview,
  userPage,
  userWorkspaces,
  workspacePage,
  workspacePeople,
} from "./queries"
import { changePlan } from "./plan-actions"
import { customerOperation } from "./customer-actions"
import { setCreditBalance } from "./credit-accounts"
import { changeWorkspaceOverride } from "./overrides"
import {
  executeOperationalMutation,
  getPlatformUser,
  getPlatformWorkspace,
} from "./operations"
import { enforcePlatformMutationRateLimit } from "./access"
import { db } from "@/db/index"
import {
  billingRequests,
  dodoWebhookInbox,
  member,
  organization,
  platformAdminAuditLog,
  platformRequestNonces,
  user,
} from "@/db/schema"
import {
  activeOverride,
  effectiveSubscription,
  readWorkspaceOverride,
} from "@/server/entitlements/effective"

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  })
}
async function readBody(request: Request) {
  if (!request.body) return ""
  const reader = request.body.getReader()
  const chunks: Array<Uint8Array> = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 32768) {
        await reader.cancel()
        throw new PlatformRequestError(413, "Request too large")
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks).toString("utf8")
}
const operationalActions = new Set([
  "set_workspace_plan",
  "adjust_credits",
  "replay_webhook",
  "reconcile_subscription",
  "mark_team_request_in_review",
  "decline_team_request",
  "approve_team_request",
  "approve_team_cancellation",
])

export async function handlePlatformRequest(request: Request) {
  try {
    if (!["GET", "POST"].includes(request.method))
      throw new PlatformRequestError(405, "Method not allowed")
    const body = request.method === "POST" ? await readBody(request) : ""
    if (body.length > 32_768)
      throw new PlatformRequestError(413, "Request too large")
    const claims = verifyPlatformAssertion(request, body)
    const actor = { userId: `staff:${claims.sub}`, email: claims.email }
    const url = new URL(request.url)
    const parts = url.pathname
      .replace(/^\/api\/internal\/platform\/?/, "")
      .split("/")
      .filter(Boolean)
      .map(decodeURIComponent)
    if (request.method === "POST") {
      enforcePlatformMutationRateLimit(actor.userId)
      await db
        .delete(platformRequestNonces)
        .where(lt(platformRequestNonces.expiresAt, new Date().toISOString()))
      const used = await db
        .insert(platformRequestNonces)
        .values({
          id: claims.jti,
          expiresAt: new Date(claims.exp * 1000).toISOString(),
        })
        .onConflictDoNothing()
        .returning()
      if (!used.length)
        throw new PlatformRequestError(409, "Operator request already used")
      if (parts.join("/") !== "mutations")
        throw new PlatformRequestError(404, "Not found")
      let input: { action?: string }
      try {
        input = JSON.parse(body)
      } catch {
        throw new PlatformRequestError(400, "Invalid JSON")
      }
      if (!input || typeof input !== "object" || Array.isArray(input))
        throw new PlatformRequestError(400, "Invalid operator command")
      if (input.action === "change_workspace_access")
        return json({ result: await changeWorkspaceAccess(input, actor) })
      if (["invite_customer", "invite_team_member", "cancel_team_invitation", "revoke_customer_session"].includes(input.action ?? ""))
        return json({ result: await customerOperation(input, actor) })
      if (input.action === "manage_workspace_member")
        return json({ result: await manageWorkspaceMember(input, actor) })
      if (input.action === "change_plan")
        return json({ result: await changePlan(input, actor) })
      if (input.action === "set_credit_balance")
        return json({ result: await setCreditBalance(input, actor) })
      if (input.action === "set_override" || input.action === "remove_override")
        return json({ result: await changeWorkspaceOverride(input, actor) })
      if (!input.action || !operationalActions.has(input.action))
        throw new PlatformRequestError(400, "Unsupported operator command")
      return json({ result: await executeOperationalMutation(actor, input) })
    }
    const q = listQuerySchema.parse(Object.fromEntries(url.searchParams))
    if (parts[0] === "overview") return json(await platformOverview(q.days))
    if (parts[0] === "users" && parts[1]) {
      const detail = await getPlatformUser(parts[1])
      if (!detail) throw new PlatformRequestError(404, "User not found")
      return json({ ...detail, workspaces: await userWorkspaces(parts[1]) })
    }
    if (parts[0] === "users") return json(await userPage(q))
    if (parts[0] === "workspaces" && parts[1] && parts[2]) {
      const type = parts[1]
      if (type !== "personal" && type !== "organization")
        throw new PlatformRequestError(400, "Invalid workspace type")
      const id = parts[2]
      const override = await readWorkspaceOverride(db, { type, id })
      const detail = await getPlatformWorkspace(type, id)
      if (detail) {
        const effective = effectiveSubscription(detail.subscription, override)
        const seatCapacity =
          effective.overrideSeatLimit ??
          (type === "personal"
            ? 1
            : effective.planKey === "pro"
              ? effective.paidSeatQuantity
              : null)
        return json({
          ...detail,
          people: await workspacePeople(type, id),
          override,
          activeOverride: activeOverride(override),
          effective: { ...effective, seatCapacity },
        })
      }
      const target = type === "personal" ? user : organization
      const [identity] = await db
        .select({ id: target.id, name: target.name })
        .from(target)
        .where(eq(target.id, id))
        .limit(1)
      if (!identity) throw new PlatformRequestError(404, "Workspace not found")
      const members =
        type === "organization"
          ? await db
              .select({
                memberId: member.id,
                userId: user.id,
                name: user.name,
                email: user.email,
                role: member.role,
              })
              .from(member)
              .innerJoin(user, eq(member.userId, user.id))
              .where(eq(member.organizationId, id))
          : []
      return json({
        name: identity.name,
        subscription: null,
        effective: null,
        override,
        members,
        people: await workspacePeople(type, id),
        invitations: [],
        usage: [],
        missingSubscription: true,
      })
    }
    if (parts[0] === "workspaces") return json(await workspacePage(q))
    if (["requests", "webhooks", "audit"].includes(parts[0])) {
      const table =
        parts[0] === "requests"
          ? billingRequests
          : parts[0] === "webhooks"
            ? dodoWebhookInbox
            : platformAdminAuditLog
      const order =
        parts[0] === "webhooks"
          ? dodoWebhookInbox.receivedAt
          : parts[0] === "requests"
            ? billingRequests.createdAt
            : platformAdminAuditLog.createdAt
      const filter =
        parts[0] === "webhooks"
          ? eq(dodoWebhookInbox.processingStatus, "failed")
          : parts[0] === "requests" && q.requestStatus !== "all"
            ? eq(billingRequests.status, q.requestStatus)
            : undefined
      const search = q.q
        ? parts[0] === "requests"
          ? sql`position(lower(${q.q}) in lower(concat(${billingRequests.email},' ',${billingRequests.workspaceName},' ',${billingRequests.status})))>0`
          : parts[0] === "audit"
            ? sql`position(lower(${q.q}) in lower(concat(${platformAdminAuditLog.actorUserId},' ',${platformAdminAuditLog.targetId},' ',${platformAdminAuditLog.action},' ',${platformAdminAuditLog.reason})))>0`
            : sql`position(lower(${q.q}) in lower(concat(${dodoWebhookInbox.webhookId},' ',${dodoWebhookInbox.lastError})))>0`
        : undefined
      const userTarget = q.userId ? `"userId":${JSON.stringify(q.userId)}` : ""
      const scope =
        parts[0] === "audit" && q.userId
          ? sql`(${platformAdminAuditLog.targetId}=${q.userId} OR split_part(${platformAdminAuditLog.targetId},':',2)=${q.userId} OR split_part(${platformAdminAuditLog.targetId},':',3)=${q.userId} OR position(${userTarget} in coalesce(${platformAdminAuditLog.beforeState},''))>0 OR position(${userTarget} in coalesce(${platformAdminAuditLog.afterState},''))>0)`
          : parts[0] === "audit" && q.workspaceId
            ? sql`(${platformAdminAuditLog.targetId}=${q.workspaceId} OR split_part(${platformAdminAuditLog.targetId},':',2)=${q.workspaceId})`
            : undefined
      const [items, totals] = await Promise.all([
        db
          .select()
          .from(table)
          .where(and(filter, search, scope))
          .orderBy(
            desc(order),
            desc(
              parts[0] === "webhooks"
                ? dodoWebhookInbox.webhookId
                : parts[0] === "requests"
                  ? billingRequests.id
                  : platformAdminAuditLog.id
            )
          )
          .limit(q.pageSize)
          .offset((q.page - 1) * q.pageSize),
        db
          .select({ total: sql<number>`count(*)::int` })
          .from(table)
          .where(and(filter, search, scope)),
      ])
      return json({
        items,
        total: totals[0]?.total ?? 0,
        page: q.page,
        pageSize: q.pageSize,
      })
    }
    throw new PlatformRequestError(404, "Not found")
  } catch (error) {
    if (error instanceof PlatformRequestError)
      return json({ error: error.message }, error.status)
    if (error instanceof APIError)
      return json({ error: error.message }, error.statusCode)
    if (error instanceof ZodError)
      return json(
        { error: "Invalid operator request", issues: error.issues },
        400
      )
    console.error(
      "[platform] operation failed",
      error instanceof Error ? error.message : "unknown error"
    )
    return json({ error: "The operation failed. Refresh and retry." }, 500)
  }
}
