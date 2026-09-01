import { and, eq, inArray } from "drizzle-orm"
import type { Database } from "@/db/client"
import {
  apiKeys,
  articles,
  chatMessages,
  chatThreads,
  creditLedger,
  feedShares,
  feeds,
  folderShares,
  folders,
  invites,
  member,
  organization,
  scrapedArticles,
  scrapedFeeds,
  session,
  usageCounters,
  workspaceSubscriptions,
} from "@/db/schema"

export interface OwnedWorkspace {
  id: string
  name: string
}

export async function ownedWorkspacesForUser(
  database: Database,
  userId: string
): Promise<Array<OwnedWorkspace>> {
  return database
    .select({ id: organization.id, name: organization.name })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(and(eq(member.userId, userId), eq(member.role, "owner")))
    .orderBy(organization.name)
}

export async function hasManagedPersonalPlusSubscription(
  database: Database,
  userId: string
): Promise<boolean> {
  const [subscription] = await database
    .select({ workspaceId: workspaceSubscriptions.workspaceId })
    .from(workspaceSubscriptions)
    .where(
      and(
        eq(workspaceSubscriptions.workspaceType, "personal"),
        eq(workspaceSubscriptions.workspaceId, userId),
        eq(workspaceSubscriptions.planKey, "personal_plus"),
        eq(workspaceSubscriptions.billingSource, "dodo")
      )
    )
    .limit(1)

  return Boolean(subscription)
}

/**
 * Removes data whose tenancy anchor is the user's personal workspace id.
 * Better Auth owns the user, sessions, accounts, and organization memberships;
 * its foreign keys remove those records when the user row is deleted.
 */
export async function deletePersonalWorkspaceData(
  database: Database,
  userId: string
): Promise<void> {
  const personalFeeds = await database
    .select({ id: feeds.id })
    .from(feeds)
    .where(eq(feeds.workspaceId, userId))
  const feedIds = personalFeeds.map((feed) => feed.id)

  if (feedIds.length > 0) {
    await database.delete(feedShares).where(inArray(feedShares.feedId, feedIds))
    await database.delete(articles).where(inArray(articles.feedId, feedIds))
  }
  await database.delete(feeds).where(eq(feeds.workspaceId, userId))

  const personalFolders = await database
    .select({ id: folders.id })
    .from(folders)
    .where(eq(folders.workspaceId, userId))
  const folderIds = personalFolders.map((folder) => folder.id)
  if (folderIds.length > 0) {
    await database
      .delete(folderShares)
      .where(inArray(folderShares.folderId, folderIds))
  }
  await database.delete(folders).where(eq(folders.workspaceId, userId))

  const userThreads = await database
    .select({ id: chatThreads.id })
    .from(chatThreads)
    .where(eq(chatThreads.userId, userId))
  const threadIds = userThreads.map((thread) => thread.id)
  if (threadIds.length > 0) {
    await database
      .delete(chatMessages)
      .where(inArray(chatMessages.threadId, threadIds))
  }
  await database.delete(chatThreads).where(eq(chatThreads.userId, userId))

  await database.delete(apiKeys).where(eq(apiKeys.workspaceId, userId))
  await database.delete(invites).where(eq(invites.workspaceId, userId))
  await database
    .delete(scrapedArticles)
    .where(eq(scrapedArticles.workspaceId, userId))
  await database
    .delete(scrapedFeeds)
    .where(eq(scrapedFeeds.workspaceId, userId))
  await database
    .delete(usageCounters)
    .where(
      and(
        eq(usageCounters.workspaceType, "personal"),
        eq(usageCounters.workspaceId, userId)
      )
    )
  await database
    .delete(creditLedger)
    .where(
      and(
        eq(creditLedger.workspaceType, "personal"),
        eq(creditLedger.workspaceId, userId)
      )
    )
  await database
    .delete(workspaceSubscriptions)
    .where(
      and(
        eq(workspaceSubscriptions.workspaceType, "personal"),
        eq(workspaceSubscriptions.workspaceId, userId)
      )
    )
}

/** Removes all application data for a Better Auth organization workspace. */
export async function deleteOrganizationWorkspaceData(
  database: Database,
  organizationId: string
): Promise<void> {
  const workspaceFeeds = await database
    .select({ id: feeds.id })
    .from(feeds)
    .where(eq(feeds.workspaceId, organizationId))
  const feedIds = workspaceFeeds.map((feed) => feed.id)
  if (feedIds.length > 0) {
    await database.delete(feedShares).where(inArray(feedShares.feedId, feedIds))
    await database.delete(articles).where(inArray(articles.feedId, feedIds))
  }
  await database.delete(feeds).where(eq(feeds.workspaceId, organizationId))

  const workspaceFolders = await database
    .select({ id: folders.id })
    .from(folders)
    .where(eq(folders.workspaceId, organizationId))
  const folderIds = workspaceFolders.map((folder) => folder.id)
  if (folderIds.length > 0) {
    await database
      .delete(folderShares)
      .where(inArray(folderShares.folderId, folderIds))
  }
  await database.delete(folders).where(eq(folders.workspaceId, organizationId))

  const workspaceThreads = await database
    .select({ id: chatThreads.id })
    .from(chatThreads)
    .where(eq(chatThreads.workspaceId, organizationId))
  const threadIds = workspaceThreads.map((thread) => thread.id)
  if (threadIds.length > 0) {
    await database
      .delete(chatMessages)
      .where(inArray(chatMessages.threadId, threadIds))
  }
  await database
    .delete(chatThreads)
    .where(eq(chatThreads.workspaceId, organizationId))

  await database.delete(apiKeys).where(eq(apiKeys.workspaceId, organizationId))
  await database.delete(invites).where(eq(invites.workspaceId, organizationId))
  await database
    .delete(scrapedArticles)
    .where(eq(scrapedArticles.workspaceId, organizationId))
  await database
    .delete(scrapedFeeds)
    .where(eq(scrapedFeeds.workspaceId, organizationId))
  await database
    .delete(usageCounters)
    .where(
      and(
        eq(usageCounters.workspaceType, "organization"),
        eq(usageCounters.workspaceId, organizationId)
      )
    )
  await database
    .delete(creditLedger)
    .where(
      and(
        eq(creditLedger.workspaceType, "organization"),
        eq(creditLedger.workspaceId, organizationId)
      )
    )
  await database
    .delete(workspaceSubscriptions)
    .where(
      and(
        eq(workspaceSubscriptions.workspaceType, "organization"),
        eq(workspaceSubscriptions.workspaceId, organizationId)
      )
    )
  await database
    .update(session)
    .set({ activeOrganizationId: null })
    .where(eq(session.activeOrganizationId, organizationId))
  await database.delete(organization).where(eq(organization.id, organizationId))
}
