import { sql } from "drizzle-orm"
import type { ListQuery, Page } from "./contracts"
import type { PlanKey, WorkspaceAccessState } from "@/server/entitlements/types"
import { db } from "@/db/index"

export interface WorkspaceListItem {
  workspaceType: "personal" | "organization"
  workspaceId: string
  name: string
  ownerId: string | null
  ownerEmail: string | null
  billedPlan: PlanKey | null
  effectivePlan: PlanKey | null
  billingSource: string | null
  billingStatus: string | null
  accessState: WorkspaceAccessState
  seatCapacity: number | null
  members: number
  pendingInvitations: number
  hasOverride: boolean
  manualPlan: boolean
  revision: number
  missingSubscription: boolean
  updatedAt: string
  createdAt: string
  creditsAvailable: number
  creditsReserved: number
}
export interface WorkspaceMembership extends Pick<
  WorkspaceListItem,
  | "workspaceType"
  | "workspaceId"
  | "name"
  | "billedPlan"
  | "effectivePlan"
  | "billingSource"
  | "billingStatus"
  | "accessState"
  | "seatCapacity"
  | "manualPlan"
  | "revision"
> {
  role: string
  userId: string
  memberId: string
  userName: string
  email: string
  image: string | null
  credits: {
    available: number
    free: number
    paid: number
    retained: number
    reserved: number
    revision: string
  }
}
export interface UserListItem {
  id: string
  name: string
  email: string
  image: string | null
  emailVerified: boolean
  banned: boolean
  lastActivityAt: string | null
  createdAt: string
  workspaces: Array<WorkspaceMembership>
  // Kept for the embedded admin during the additive rollout.
  billedPlan: PlanKey | null
  effectivePlan: PlanKey
  hasOverride: boolean
  memberships: Array<{ id: string; name: string; role: string }>
}

/** Personal membership is implicit in auth storage, but explicit in this read model. */
export const workspaceCte = sql`WITH identities AS (
 SELECT 'personal'::text kind,u.id,concat(u.name,'''s workspace') name,u.id owner_id,u.email owner_email,u.created_at,u.updated_at FROM "user" u
 UNION ALL SELECT 'organization',o.id,o.name,owner.id,owner.email,o.created_at,o.created_at FROM organization o
 LEFT JOIN LATERAL (SELECT u.id,u.email FROM member m JOIN "user" u ON u.id=m.user_id WHERE m.organization_id=o.id AND m.role='owner' ORDER BY m.created_at,m.id LIMIT 1) owner ON true
), inventory AS (
 SELECT i.*,coalesce(s.plan_key,CASE WHEN i.kind='personal' THEN 'free' END) billed_plan,
 coalesce(s.billing_source,CASE WHEN i.kind='personal' THEN 'free' END) billing_source,
 s.current_period_end AS period_end,
 coalesce(s.subscription_status,CASE WHEN i.kind='personal' THEN 'free' END) subscription_status,
 coalesce(v.plan_key,s.plan_key,CASE WHEN i.kind='personal' THEN 'free' END) effective_plan,
 coalesce(v.access_restriction,CASE WHEN v.plan_key IS NOT NULL THEN 'active' END,s.access_state,CASE WHEN i.kind='personal' THEN 'active' ELSE 'suspended' END) access_state,
 coalesce(v.seat_limit,CASE WHEN v.plan_key IS NULL OR v.plan_key=s.plan_key THEN s.override_seat_limit END,CASE WHEN i.kind='personal' THEN 1 WHEN coalesce(v.plan_key,s.plan_key)='pro' THEN s.paid_seat_quantity END) seat_capacity,
 v.plan_key IS NOT NULL manual_plan,v.workspace_id IS NOT NULL has_override,coalesce(raw.revision,0) revision,
 s.workspace_id IS NULL missing_subscription,greatest(coalesce(s.updated_at,i.updated_at::text),coalesce(v.updated_at,i.updated_at::text)) changed_at,
 CASE WHEN i.kind='personal' THEN 1 ELSE (SELECT count(*)::int FROM member m WHERE m.organization_id=i.id) END members,
 (SELECT count(DISTINCT lower(n.email))::int FROM invitation n WHERE n.organization_id=i.id AND n.status='pending' AND n.expires_at>now() AND NOT EXISTS(SELECT 1 FROM member m JOIN "user" u ON u.id=m.user_id WHERE m.organization_id=i.id AND lower(u.email)=lower(n.email))) pending
 FROM identities i LEFT JOIN workspace_subscriptions s ON s.workspace_type=i.kind AND s.workspace_id=i.id
 LEFT JOIN workspace_overrides raw ON raw.workspace_type=i.kind AND raw.workspace_id=i.id
 LEFT JOIN workspace_overrides v ON v.workspace_type=i.kind AND v.workspace_id=i.id AND (v.expires_at IS NULL OR v.expires_at::timestamptz>now())
), workspace_people AS (
 SELECT 'personal'::text kind,u.id workspace_id,u.id user_id,concat('personal:',u.id) member_id,'owner'::text role FROM "user" u
 UNION ALL SELECT 'organization',m.organization_id,m.user_id,m.id,m.role FROM member m
), credit_totals AS (
 SELECT workspace_type,workspace_id,beneficiary_user_id,
 greatest(coalesce(sum(amount) FILTER (WHERE credit_bucket='free'),0),0) free,
 greatest(coalesce(sum(amount) FILTER (WHERE credit_bucket='paid'),0),0) paid,
 coalesce(sum(-amount) FILTER (WHERE entry_type='reservation' AND NOT EXISTS(SELECT 1 FROM credit_ledger f WHERE f.workspace_type=l.workspace_type AND f.workspace_id=l.workspace_id AND f.beneficiary_user_id=l.beneficiary_user_id AND f.ai_request_id=l.ai_request_id AND f.credit_bucket=l.credit_bucket AND f.entry_type IN ('settlement','refund'))),0) reserved,
 md5(string_agg(id,',' ORDER BY id)) credit_revision
 FROM credit_ledger l GROUP BY workspace_type,workspace_id,beneficiary_user_id
)`
const workspaceFields = sql`i.kind AS "workspaceType",i.id AS "workspaceId",i.name,i.owner_id AS "ownerId",i.owner_email AS "ownerEmail",
 i.billed_plan AS "billedPlan",i.effective_plan AS "effectivePlan",i.billing_source AS "billingSource",i.subscription_status AS "billingStatus",
 i.access_state AS "accessState",i.seat_capacity AS "seatCapacity",i.members,i.pending AS "pendingInvitations",i.has_override AS "hasOverride",i.manual_plan AS "manualPlan",i.revision,
 i.missing_subscription AS "missingSubscription",i.changed_at AS "updatedAt",i.created_at AS "createdAt"`
const membershipJson = sql`jsonb_build_object('workspaceType',i.kind,'workspaceId',i.id,'name',i.name,'role',p.role,'userId',p.user_id,'memberId',p.member_id,
 'billedPlan',i.billed_plan,'effectivePlan',i.effective_plan,'billingStatus',i.subscription_status,'billingSource',i.billing_source,'accessState',i.access_state,'manualPlan',i.manual_plan,'revision',i.revision,'seatCapacity',i.seat_capacity,
 'credits',jsonb_build_object('available',coalesce(c.free,0)+CASE WHEN i.effective_plan='free' THEN 0 ELSE coalesce(c.paid,0) END,'free',coalesce(c.free,0),'paid',coalesce(c.paid,0),'retained',CASE WHEN i.effective_plan='free' THEN coalesce(c.paid,0) ELSE 0 END,'reserved',coalesce(c.reserved,0),'revision',coalesce(c.credit_revision,md5(''))))`
function workspaceWhere(q: ListQuery) {
  return sql`WHERE (${q.type}='all' OR i.kind=${q.type}) AND (${q.plan}='all' OR i.effective_plan=${q.plan}) AND (${q.status}='all' OR i.access_state=${q.status})
 AND (${q.q}='' OR position(lower(${q.q}) in lower(concat(i.name,' ',i.id,' ',i.owner_email)))>0)`
}
export async function workspacePage(
  q: ListQuery
): Promise<Page<WorkspaceListItem>> {
  const order =
      q.sort === "name"
        ? sql`i.name`
        : q.sort === "created"
          ? sql`i.created_at`
          : sql`i.changed_at`,
    direction = q.direction === "asc" ? sql`ASC` : sql`DESC`
  const [items, totals] = await Promise.all([
    db.execute(sql`${workspaceCte} SELECT ${workspaceFields},
   coalesce((SELECT sum(coalesce(c.free,0)+CASE WHEN i.effective_plan='free' THEN 0 ELSE coalesce(c.paid,0) END) FROM workspace_people p LEFT JOIN credit_totals c ON c.workspace_type=p.kind AND c.workspace_id=p.workspace_id AND c.beneficiary_user_id=p.user_id WHERE p.kind=i.kind AND p.workspace_id=i.id),0) AS "creditsAvailable",
   coalesce((SELECT sum(c.reserved) FROM workspace_people p JOIN credit_totals c ON c.workspace_type=p.kind AND c.workspace_id=p.workspace_id AND c.beneficiary_user_id=p.user_id WHERE p.kind=i.kind AND p.workspace_id=i.id),0) AS "creditsReserved"
   FROM inventory i ${workspaceWhere(q)} ORDER BY ${order} ${direction},i.kind,i.id LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`),
    db.execute(
      sql`${workspaceCte} SELECT count(*)::int total FROM inventory i ${workspaceWhere(q)}`
    ),
  ])
  return {
    items: Array.from(items) as unknown as Array<WorkspaceListItem>,
    total: Number(totals[0]?.total ?? 0),
    page: q.page,
    pageSize: q.pageSize,
  }
}
export async function userWorkspaces(
  userId: string
): Promise<Array<WorkspaceMembership>> {
  const rows =
    await db.execute(sql`${workspaceCte} SELECT ${membershipJson} AS membership FROM workspace_people p JOIN inventory i ON i.kind=p.kind AND i.id=p.workspace_id
 LEFT JOIN credit_totals c ON c.workspace_type=p.kind AND c.workspace_id=p.workspace_id AND c.beneficiary_user_id=p.user_id WHERE p.user_id=${userId} ORDER BY i.kind DESC,i.name,i.id`)
  return rows.map((r) => r.membership) as Array<WorkspaceMembership>
}
export async function workspacePeople(
  type: "personal" | "organization",
  id: string
): Promise<Array<WorkspaceMembership>> {
  const rows =
    await db.execute(sql`${workspaceCte} SELECT ${membershipJson} || jsonb_build_object('userName',u.name,'email',u.email,'image',u.image) AS membership
 FROM workspace_people p JOIN inventory i ON i.kind=p.kind AND i.id=p.workspace_id JOIN "user" u ON u.id=p.user_id
 LEFT JOIN credit_totals c ON c.workspace_type=p.kind AND c.workspace_id=p.workspace_id AND c.beneficiary_user_id=p.user_id
 WHERE p.kind=${type} AND p.workspace_id=${id} ORDER BY CASE WHEN p.role='owner' THEN 0 ELSE 1 END,u.name,u.id`)
  return rows.map((r) => r.membership) as Array<WorkspaceMembership>
}
export async function userPage(q: ListQuery): Promise<Page<UserListItem>> {
  const banned = sql`(u.banned AND (u.ban_expires IS NULL OR u.ban_expires>now()))`
  const where = sql`WHERE (${q.q}='' OR position(lower(${q.q}) in lower(concat(u.name,' ',u.email,' ',u.id)))>0)
 AND (${q.plan}='all' OR EXISTS(SELECT 1 FROM workspace_people p JOIN inventory i ON i.kind=p.kind AND i.id=p.workspace_id WHERE p.user_id=u.id AND i.effective_plan=${q.plan}))
 AND (${q.status}='all' OR (${q.status}='banned' AND ${banned}) OR (${q.status}='unverified' AND NOT u.email_verified) OR (${q.status}='active' AND NOT ${banned}))`
  const order =
      q.sort === "name"
        ? sql`u.name`
        : q.sort === "created"
          ? sql`u.created_at`
          : sql`u.updated_at`,
    direction = q.direction === "asc" ? sql`ASC` : sql`DESC`
  const [items, totals] = await Promise.all([
    db.execute(sql`${workspaceCte} SELECT u.id,u.name,u.email,u.image,u.email_verified AS "emailVerified",${banned} AS banned,u.created_at AS "createdAt",
   coalesce((SELECT max(last_seen_at)::timestamp FROM platform_activity_days WHERE user_id=u.id),u.last_active_at) AS "lastActivityAt",
   coalesce((SELECT jsonb_agg(${membershipJson} ORDER BY i.kind DESC,i.name,i.id) FROM workspace_people p JOIN inventory i ON i.kind=p.kind AND i.id=p.workspace_id LEFT JOIN credit_totals c ON c.workspace_type=p.kind AND c.workspace_id=p.workspace_id AND c.beneficiary_user_id=p.user_id WHERE p.user_id=u.id),'[]'::jsonb) AS workspaces
   FROM "user" u ${where} ORDER BY ${order} ${direction},u.id LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`),
    db.execute(
      sql`${workspaceCte} SELECT count(*)::int total FROM "user" u ${where}`
    ),
  ])
  const people = Array.from(items).map((row) => {
    const workspaces = row.workspaces as Array<WorkspaceMembership>,
      personal = workspaces.find((w) => w.workspaceType === "personal")
    return {
      ...row,
      billedPlan: personal?.billedPlan ?? "free",
      effectivePlan: personal?.effectivePlan ?? "free",
      hasOverride: personal?.manualPlan ?? false,
      memberships: workspaces
        .filter((w) => w.workspaceType === "organization")
        .map((w) => ({ id: w.workspaceId, name: w.name, role: w.role })),
    }
  }) as unknown as Array<UserListItem>
  return {
    items: people,
    total: Number(totals[0]?.total ?? 0),
    page: q.page,
    pageSize: q.pageSize,
  }
}

export async function platformOverview(days = 30) {
  const start = new Date()
  start.setUTCHours(0, 0, 0, 0)
  start.setUTCDate(start.getUTCDate() - days + 1)
  const startDay = start.toISOString().slice(0, 10)
  const [counts] =
    await db.execute(sql`${workspaceCte} SELECT (SELECT count(*)::int FROM "user") AS users,count(*)::int AS workspaces,
  count(*) FILTER(WHERE kind='organization')::int AS "teamWorkspaces",
  count(*) FILTER(WHERE billing_source IN ('dodo','manual') AND (subscription_status IN ('active','past_due') OR (kind='personal' AND subscription_status='canceled' AND period_end::timestamptz>now())) AND billed_plan<>'free')::int AS "subscribedWorkspaces",
  count(*) FILTER(WHERE manual_plan)::int AS "manualPlans",
  (SELECT count(DISTINCT user_id)::int FROM platform_activity_days WHERE day>=${startDay}) AS "activeUsers",
  (SELECT count(*)::int FROM billing_requests WHERE status IN ('pending','in_review')) AS "openRequests",
  (SELECT count(*)::int FROM dodo_webhook_inbox WHERE processing_status='failed') AS "failedWebhooks" FROM inventory`)
  const distribution = await db.execute(
    sql`${workspaceCte} SELECT coalesce(effective_plan,'unassigned') plan,count(*)::int count FROM inventory GROUP BY effective_plan ORDER BY effective_plan`
  )
  const [history] = await db.execute(
    sql`SELECT min(day) AS since FROM platform_activity_days`
  )
  const series =
    await db.execute(sql`WITH dates AS (SELECT generate_series(${startDay}::date,(now() AT TIME ZONE 'UTC')::date,interval '1 day')::date AS "day")
  SELECT d.day::text AS "day",(SELECT count(*)::int FROM "user" WHERE (created_at AT TIME ZONE 'UTC')::date=d.day) AS "newUsers",
  (SELECT count(*)::int FROM "user" WHERE (created_at AT TIME ZONE 'UTC')::date<=d.day) AS "totalUsers",
  CASE WHEN ${history.since ?? null}::text IS NULL OR d.day::text<${history.since ?? null}::text THEN NULL ELSE (SELECT count(DISTINCT user_id)::int FROM platform_activity_days WHERE day=d.day::text) END AS "activeUsers"
  FROM dates d ORDER BY d.day`)
  return {
    users: Number(counts.users),
    workspaces: Number(counts.workspaces),
    teamWorkspaces: Number(counts.teamWorkspaces),
    subscribedWorkspaces: Number(counts.subscribedWorkspaces),
    manualPlans: Number(counts.manualPlans),
    activeUsers: Number(counts.activeUsers),
    openRequests: Number(counts.openRequests),
    failedWebhooks: Number(counts.failedWebhooks),
    distribution: Array.from(distribution).map((row) => ({
      plan: String(row.plan),
      count: Number(row.count),
    })),
    series: Array.from(series).map((row) => ({
      day: String(row.day),
      newUsers: Number(row.newUsers),
      totalUsers: Number(row.totalUsers),
      activeUsers: row.activeUsers === null ? null : Number(row.activeUsers),
    })),
    activitySince: typeof history.since === "string" ? history.since : null,
    days,
  }
}
