import { createServerFn } from "@tanstack/react-start"
import { resolveWorkspaceId } from "./services/context"
import { feedInWorkspace, folderInWorkspace } from "./services/tenancy"
import { FEED_ORDER, FOLDER_ORDER } from "./services/ordering"
import { db } from "@/db/index"
import { feeds, folders } from "@/db/schema"
import catalogueConfig from "@/config/catalogue.json"
import { DEMO_MODE } from "@/lib/demo"

/**
 * Everything the command palette can jump to, and nothing else.
 *
 * Deliberately not `getAllData()`. That loader joins share rows, pulls two
 * hundred articles and normalises scraped sources — all of it wasted on a list
 * of names. The palette needs four columns, so it asks for four columns.
 *
 * Scraped feeds are omitted on purpose: they are absent from `getAllData`'s
 * consumers too (no component reads `scrapedFeeds`), so indexing them would
 * offer jumps to destinations the sidebar does not have.
 */
export type NavIndex = {
  folders: Array<{ id: string; name: string }>
  feeds: Array<{ id: string; name: string; folderId: string | null }>
  categories: Array<{ slug: string; name: string }>
}

/**
 * Discover's categories, read here rather than in the client.
 *
 * `catalogue.json` carries 115 sources with blurbs and icon paths. Importing it
 * into a client component to reach fifteen names would ship the whole file to
 * every browser.
 */
const CATEGORIES: NavIndex["categories"] = (
  catalogueConfig as { categories: Array<{ slug: string; name: string }> }
).categories.map((c) => ({ slug: c.slug, name: c.name }))

export const getNavIndex = createServerFn({ method: "GET" }).handler(
  async (): Promise<NavIndex> => {
    if (DEMO_MODE) {
      const { ensureDemoSchema } = await import("@/server/demo-seeder")
      await ensureDemoSchema()
    }

    const workspaceId = await resolveWorkspaceId()

    const [folderRows, feedRows] = await Promise.all([
      db
        .select({ id: folders.id, name: folders.name })
        .from(folders)
        .where(folderInWorkspace(workspaceId))
        .orderBy(...FOLDER_ORDER),
      db
        .select({ id: feeds.id, name: feeds.name, folderId: feeds.folderId })
        .from(feeds)
        .where(feedInWorkspace(workspaceId))
        .orderBy(...FEED_ORDER),
    ])

    return { folders: folderRows, feeds: feedRows, categories: CATEGORIES }
  },
)
