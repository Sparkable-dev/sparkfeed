import { randomUUID } from "node:crypto"
import { and, eq, sql } from "drizzle-orm"
import { buildFeedRows, cleanFolderName } from "./feed-write"
import { enqueueIngest } from "./ingest-queue"
import {
  OpmlDocumentError,
  opmlSubscriptionKey,
  parseOpmlDocument,
  serializeOpmlDocument,
} from "./opml-document"
import { FEED_ORDER, FOLDER_ORDER } from "./ordering"
import { feedInWorkspace, folderInWorkspace } from "./tenancy"
import type { Database } from "@/db/client"
import type { OpmlDestination } from "@/lib/opml"
import { db } from "@/db/index"
import { feeds, folders } from "@/db/schema"
import { chunk } from "@/lib/bulk-urls"

const INSERT_BATCH_SIZE = 250

async function planImport(
  database: Pick<Database, "select">,
  workspaceId: string,
  document: ReturnType<typeof parseOpmlDocument>
) {
  const [existing, workspaceFolders] = await Promise.all([
    database
      .select({ url: feeds.url })
      .from(feeds)
      .where(feedInWorkspace(workspaceId)),
    database
      .select({ id: folders.id, name: folders.name })
      .from(folders)
      .where(folderInWorkspace(workspaceId))
      .orderBy(...FOLDER_ORDER),
  ])
  const known = new Set(existing.map(({ url }) => opmlSubscriptionKey(url)))
  const seen = new Set<string>()
  const skipped = [...document.skipped]
  const newFeeds = document.feeds.filter(({ url, name }) => {
    const key = opmlSubscriptionKey(url)
    const reason = known.has(key)
      ? "Already in this workspace"
      : seen.has(key)
        ? "Repeated in this file"
        : null
    if (reason) skipped.push({ name, reason })
    seen.add(key)
    return reason === null
  })

  const folderIds = new Map<string, string>()
  for (const folder of workspaceFolders) {
    if (!folderIds.has(folder.name)) folderIds.set(folder.name, folder.id)
  }

  const folderCounts = new Map<string, number>()
  for (const { folder } of newFeeds) {
    if (folder !== null)
      folderCounts.set(folder, (folderCounts.get(folder) ?? 0) + 1)
  }
  for (const name of document.emptyFolders) {
    if (!folderCounts.has(name)) folderCounts.set(name, 0)
  }
  return { newFeeds, skipped, folderIds, folderCounts, workspaceFolders }
}

export async function previewOpmlSubscriptions(
  workspaceId: string,
  xml: string
) {
  const document = parseOpmlDocument(xml)
  const plan = await planImport(db, workspaceId, document)
  return {
    newFeeds: plan.newFeeds.length,
    unfiled: plan.newFeeds.filter(({ folder }) => folder === null).length,
    hasFolders: document.hasFolders,
    folders: [...plan.folderCounts].map(([name, count]) => ({
      name,
      count,
      exists: plan.folderIds.has(name),
    })),
    skipped: plan.skipped,
    workspaceFolders: plan.workspaceFolders,
  }
}

export async function importOpmlSubscriptions(
  workspaceId: string,
  xml: string,
  destination: OpmlDestination
) {
  const document = parseOpmlDocument(xml)
  const imported = await db.transaction(async (tx) => {
    // Serialize imports for this workspace and recheck the preview against current data.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('sparkfeed-opml'), hashtext(${workspaceId}))`
    )
    const { newFeeds, skipped, folderIds, folderCounts, workspaceFolders } =
      await planImport(tx, workspaceId, document)
    const newFolders: Array<{ id: string; name: string; workspaceId: string }> =
      []
    const createFolder = (name: string) => {
      const id = randomUUID()
      folderIds.set(name, id)
      newFolders.push({ id, name, workspaceId })
      return id
    }

    let targetId: string | null = null
    switch (destination.kind) {
      case "existing":
        if (!workspaceFolders.some(({ id }) => id === destination.folderId))
          throw new OpmlDocumentError(
            "That folder is no longer available. Choose another folder."
          )
        targetId = destination.folderId
        break
      case "new": {
        if (newFeeds.length === 0) break
        const name = cleanFolderName(destination.name)
        if (!name) throw new OpmlDocumentError("Enter a folder name.")
        if (folderIds.has(name))
          throw new OpmlDocumentError(
            "That folder already exists. Choose it or enter a different name."
          )
        targetId = createFolder(name)
        break
      }
      case "preserve":
        for (const name of folderCounts.keys()) {
          if (!folderIds.has(name)) createFolder(name)
        }
        break
    }

    const rows = buildFeedRows(
      workspaceId,
      newFeeds.map(({ name, url, folder }) => ({
        name,
        url,
        folderId:
          destination.kind === "preserve" && folder !== null
            ? folderIds.get(folder)!
            : targetId,
      }))
    )
    for (const batch of chunk(newFolders, INSERT_BATCH_SIZE))
      await tx.insert(folders).values(batch)
    for (const batch of chunk(rows, INSERT_BATCH_SIZE))
      await tx.insert(feeds).values(batch)
    return { rows, foldersCreated: newFolders.length, skipped }
  })

  enqueueIngest(
    imported.rows.map(({ id, url, kind }) => ({ feedId: id, url, kind }))
  )
  return {
    added: imported.rows.length,
    foldersCreated: imported.foldersCreated,
    skipped: imported.skipped,
  }
}

export async function exportOpmlSubscriptions(
  workspaceId: string,
  folderId?: string
) {
  const [workspaceFolders, subscriptions] = await Promise.all([
    db
      .select({ id: folders.id, name: folders.name })
      .from(folders)
      .where(
        and(
          folderInWorkspace(workspaceId),
          folderId ? eq(folders.id, folderId) : undefined
        )
      )
      .orderBy(...FOLDER_ORDER),
    db
      .select({ name: feeds.name, url: feeds.url, folderId: feeds.folderId })
      .from(feeds)
      .where(
        and(
          feedInWorkspace(workspaceId),
          eq(feeds.kind, "rss"),
          folderId ? eq(feeds.folderId, folderId) : undefined
        )
      )
      .orderBy(...FEED_ORDER),
  ])
  if (
    folderId
      ? !workspaceFolders.length
      : !workspaceFolders.length && !subscriptions.length
  )
    return null
  return {
    xml: serializeOpmlDocument(workspaceFolders, subscriptions),
    folderName: folderId ? workspaceFolders[0].name : null,
  }
}
