import { and, eq, inArray, sql } from "drizzle-orm"
import { sparkfeedEdition } from "../entitlements/config"
import { readEffectiveSubscription } from "../entitlements/effective"
import { articleInWorkspace } from "./tenancy"
import type { WorkspaceContext } from "./context"
import type { FavoriteScope } from "@/lib/workspace-scope"
import type { ApiPrincipal } from "../api/principal"
import { articles, personalFavorites, user } from "@/db/schema"
import { db } from "@/db/index"

export function personalFavoriteCondition(userId: string) {
  return sql<boolean>`exists (select 1 from ${personalFavorites} where ${personalFavorites.articleId} = ${articles.id} and ${personalFavorites.userId} = ${userId})`
}

/** Personal-workspace API keys save for their owner; team keys curate workspace saves. */
export async function apiFavoriteOwner(principal: ApiPrincipal) {
  if (!principal.workspaceId || principal.demo) return null
  if (
    principal.plan === "free" ||
    principal.plan === "personal_plus" ||
    principal.userId === principal.workspaceId
  )
    return principal.workspaceId
  if (principal.plan !== "community") return null
  const [owner] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, principal.workspaceId))
    .limit(1)
  return owner?.id ?? null
}

export async function apiFavoriteCondition(principal: ApiPrincipal) {
  const owner = await apiFavoriteOwner(principal)
  return owner
    ? personalFavoriteCondition(owner)
    : eq(articles.isFavorite, true)
}

export async function supportsWorkspaceFavorites(context: WorkspaceContext) {
  if (context.demo || context.workspace?.type !== "organization") return false
  if (sparkfeedEdition() === "community") return true
  const subscription = await readEffectiveSubscription(db, context.workspace)
  return (
    subscription?.planKey === "pro" || subscription?.planKey === "enterprise"
  )
}

export async function readFavoriteIds(context: WorkspaceContext) {
  if (!context.userId || !context.workspaceId || context.demo) {
    return {
      personal: [] as Array<string>,
      workspace: [] as Array<string>,
      workspaceEnabled: false,
    }
  }
  const [personal, workspace, workspaceEnabled] = await Promise.all([
    db
      .select({ id: articles.id })
      .from(articles)
      .where(
        and(
          articleInWorkspace(context.workspaceId),
          personalFavoriteCondition(context.userId)
        )
      ),
    context.workspace?.type === "organization"
      ? db
          .select({ id: articles.id })
          .from(articles)
          .where(
            and(
              articleInWorkspace(context.workspaceId),
              eq(articles.isFavorite, true)
            )
          )
      : Promise.resolve([]),
    supportsWorkspaceFavorites(context),
  ])
  return {
    personal: personal.map((row) => row.id),
    workspace: workspace.map((row) => row.id),
    workspaceEnabled,
  }
}

/** Caller must enforce workspace write access before entering this service. */
export async function writeFavorites(
  context: WorkspaceContext,
  ids: Array<string>,
  scope: FavoriteScope,
  state: boolean
) {
  if (!context.userId || !context.workspaceId || context.demo)
    throw new Error("Sign in to save favorites.")
  if (scope === "workspace" && !(await supportsWorkspaceFavorites(context)))
    throw new Error(
      "Workspace favorites require a team workspace on Pro or Enterprise."
    )
  const owned = await db
    .select({ id: articles.id })
    .from(articles)
    .where(
      and(inArray(articles.id, ids), articleInWorkspace(context.workspaceId))
    )
  const ownedIds = owned.map((row) => row.id)
  if (!ownedIds.length) return { ids: ownedIds }
  if (scope === "workspace") {
    await db
      .update(articles)
      .set({ isFavorite: state })
      .where(
        and(
          inArray(articles.id, ownedIds),
          articleInWorkspace(context.workspaceId)
        )
      )
  } else if (state) {
    await db
      .insert(personalFavorites)
      .values(
        ownedIds.map((articleId) => ({ articleId, userId: context.userId! }))
      )
      .onConflictDoNothing()
  } else {
    await db
      .delete(personalFavorites)
      .where(
        and(
          eq(personalFavorites.userId, context.userId),
          inArray(personalFavorites.articleId, ownedIds)
        )
      )
  }
  return { ids: ownedIds }
}
