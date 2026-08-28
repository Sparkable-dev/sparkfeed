import { and, inArray } from 'drizzle-orm'
import { decodeId } from './ids'
import { articleInWorkspace } from './tenancy'
import { ServiceError } from './errors'
import type { ApiPrincipal } from '../api/principal'
import { articles } from '@/db/schema'
import { db } from '@/db/index'

type Flag = 'isFavorite' | 'isUsed' | 'isBookmarked' | 'isReadLater'

/**
 * Flips one boolean on a batch of articles, scoped to the caller's workspace.
 *
 * Batched by id array rather than one call per article because an agent
 * triaging a morning's reading would otherwise make sixty round trips.
 *
 * The count returned is the number of ids that actually belonged to the
 * workspace, so a caller passing a foreign id sees `updated` fall short rather
 * than getting a confident success. It does not say *which* ids were rejected:
 * that would confirm whether an id exists.
 */
export async function setArticleFlag(
  principal: ApiPrincipal,
  flag: Flag,
  ids: Array<string>,
  state: boolean,
): Promise<{ updated: number; requested: number }> {
  if (principal.demo) {
    throw new ServiceError(
      'forbidden',
      'The demo workspace is read-only. Sign up for a free workspace to use write tools.',
    )
  }

  const rawIds = ids.map((id) => decodeId('article', id))

  const scoped = and(
    inArray(articles.id, rawIds),
    articleInWorkspace(principal.workspaceId),
  )

  // Count first: an UPDATE's affected-row count is not portable across the
  // Postgres and SQLite drivers this app runs on.
  const owned = await db.select({ id: articles.id }).from(articles).where(scoped)

  if (owned.length > 0) {
    await db.update(articles).set({ [flag]: state }).where(scoped)
  }

  return { updated: owned.length, requested: ids.length }
}
