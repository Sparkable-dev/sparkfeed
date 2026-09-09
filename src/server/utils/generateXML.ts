import { desc, inArray } from "drizzle-orm"
import { db } from "@/db/index"
import {
  articles as articlesTable,
  feeds as feedsTable,
  folders as foldersTable,
} from "@/db/schema"
import { slugify } from "@/lib/slugify"
import { workspaceIsSuspended } from "@/server/entitlements/suspension"
import { resolveInheritedShare } from "@/server/services/shares"
import { DEMO_MODE } from "@/lib/demo"

function escapeXml(unsafe: string): string {
  if (!unsafe) return ""
  return unsafe.replace(/[&<>"']/g, (m) => {
    switch (m) {
      case "&":
        return "&amp;"
      case "<":
        return "&lt;"
      case ">":
        return "&gt;"
      case '"':
        return "&quot;"
      case "'":
        return "&apos;"
      default:
        return m
    }
  })
}

export async function generateXMLFeed(
  rawFolderSlug: string,
  origin: string,
  rawFeedSlug?: string
) {
  // Strip common extensions if present
  const folderSlug = rawFolderSlug.replace(/\.(xml|feed|rss|atom)$/, "")
  const feedSlug = rawFeedSlug?.replace(/\.(xml|feed|rss|atom)$/, "")

  const folders = await db.select().from(foldersTable)
  const allFeeds = await db.select().from(feedsTable)

  let targetFeedIds: Array<string> = []
  let channelTitle = ""

  const folder = folders.find((f) => slugify(f.name) === folderSlug)

  if (folder) {
    channelTitle = folder.name
    if (feedSlug) {
      // Look for a specific feed within this folder
      const feed = allFeeds.find(
        (f) => f.folderId === folder.id && slugify(f.name) === feedSlug
      )
      if (feed) {
        targetFeedIds = [feed.id]
        channelTitle = `${folder.name} - ${feed.name}`
      }
    } else {
      // All feeds in the folder
      targetFeedIds = allFeeds
        .filter((f) => f.folderId === folder.id)
        .map((f) => f.id)
    }
  } else {
    // If no folder matches, try if the folderSlug itself is a top-level feed
    const feed = allFeeds.find((f) => slugify(f.name) === folderSlug)
    if (feed) {
      targetFeedIds = [feed.id]
      channelTitle = feed.name
    }
  }

  /*
    Watched pages need no separate lookup here. They used to be `scraped_feeds`
    rows matched by slugified title and joined to their articles by URL string;
    now they are ordinary feeds, so a folder's export includes them by virtue of
    the query above.
  */
  if (targetFeedIds.length === 0) {
    return null
  }

  // Exported feeds obey the same public-share and workspace restrictions.
  // Password-protected shares cannot be read through an unauthenticated XML URL.
  if (!DEMO_MODE) {
    const readable: Array<string> = []
    for (const id of targetFeedIds) {
      const feed = allFeeds.find((item) => item.id === id)!
      if (await workspaceIsSuspended(feed.workspaceId)) continue
      const share = await resolveInheritedShare(feed.id, "feed", {
        name: feed.name,
        parentId: feed.folderId,
      })
      if (share?.isShared && !share.password) readable.push(id)
    }
    targetFeedIds = readable
    if (!targetFeedIds.length) return null
  }

  // Fetch RSS articles
  const rssArticles =
    targetFeedIds.length > 0
      ? await db
          .select()
          .from(articlesTable)
          .where(inArray(articlesTable.feedId, targetFeedIds))
          .orderBy(desc(articlesTable.publishedAt))
          .limit(50)
      : []

  // Normalize
  const rssItems = rssArticles.map((article) => ({
    title: article.title,
    link: article.link,
    description: article.description || "",
    pubDate: article.publishedAt
      ? new Date(article.publishedAt).toUTCString()
      : "",
    guid: article.id,
    image: article.image || null,
  }))

  const allItems = [...rssItems]
    .sort(
      (a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime()
    )
    .slice(0, 50)

  const itemsXml = allItems
    .map((item) => {
      const enclosure = item.image
        ? `<enclosure url="${escapeXml(item.image)}" type="image/jpeg" length="0"/>`
        : ""
      return `    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${escapeXml(item.link)}</link>
      <description>${escapeXml(item.description)}</description>
      <pubDate>${item.pubDate}</pubDate>
      <guid isPermaLink="false">${item.guid}</guid>
      ${enclosure}
    </item>`
    })
    .join("\n")

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(channelTitle)}</title>
    <link>${origin}/${folderSlug}</link>
    <description>Latest articles from ${escapeXml(channelTitle)}</description>
    <generator>SparkFeed</generator>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${itemsXml}
  </channel>
</rss>`
}
