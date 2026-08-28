import { beforeAll, describe, expect, it, vi } from "vitest"
import type { createClient } from "@libsql/client"
import type { Database } from "@/db/client"
import { createDb } from "@/db/client"

/**
 * The tools, run against a real database.
 *
 * SQLite on purpose. Demo mode runs the Postgres table objects against libsql,
 * so anything Postgres-only in the aggregate SQL — a `FILTER (WHERE …)`, a
 * boolean compared as a literal — passes in production and breaks only on the
 * public demo. Running these here is what catches that before deploy.
 *
 * Two workspaces are seeded throughout, because almost every bug this file
 * guards against is a tenancy bug: a missing predicate reads as "works" until
 * someone else's data is in the table.
 */

let db: Database

// The services import the `db` singleton directly, so the module is swapped for
// an in-memory handle. Hoisted by vitest above the imports below.
vi.mock("@/db/index", () => ({
  get db() {
    return db
  },
}))

const A = "ws-alpha"
const B = "ws-beta"

const principal = (
  workspaceId: string | null,
  over: Record<string, unknown> = {}
) =>
  ({
    keyId: "session",
    workspaceId,
    plan: "pro" as const,
    scopes: [
      "mcp",
      "workspace:read",
      "articles:read",
      "articles:write",
      "feeds:write",
    ],
    demo: false,
    ...over,
  }) as never

beforeAll(async () => {
  db = createDb(":memory:", { sqlite: true })
  const raw = (db as unknown as { $client: ReturnType<typeof createClient> })
    .$client

  await raw.execute(`CREATE TABLE folders (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    workspace_id TEXT, parent_id TEXT, position INTEGER, created_at TEXT)`)
  await raw.execute(`CREATE TABLE feeds (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL,
    folder_id TEXT, workspace_id TEXT, kind TEXT DEFAULT 'rss',
    include_keywords TEXT, exclude_keywords TEXT, position INTEGER,
    created_at TEXT, last_fetched_at TEXT, last_error TEXT, last_error_at TEXT)`)
  await raw.execute(`CREATE TABLE articles (
    id TEXT PRIMARY KEY, feed_id TEXT, title TEXT NOT NULL, description TEXT,
    content TEXT, content_fetched_at TEXT, link TEXT NOT NULL, image TEXT,
    published_at TEXT, is_used INTEGER DEFAULT 0, visit_count INTEGER DEFAULT 0,
    is_bookmarked INTEGER DEFAULT 0, is_read_later INTEGER DEFAULT 0,
    is_favorite INTEGER DEFAULT 0, created_at TEXT)`)
  await raw.execute(`CREATE TABLE scraped_feeds (
    id TEXT PRIMARY KEY, workspace_id TEXT, folder_id TEXT, site_url TEXT,
    title TEXT, last_hash TEXT, last_fetched_at TEXT, last_error TEXT,
    last_error_at TEXT, created_at TEXT)`)
  await raw.execute(`CREATE TABLE scraped_articles (
    id TEXT PRIMARY KEY, workspace_id TEXT, folder_id TEXT, site_url TEXT,
    title TEXT, url TEXT, date TEXT, description TEXT, created_at TEXT)`)

  const { folders, feeds, articles } =
    await import("@/db/schema")
  const now = new Date().toISOString()

  await db.insert(folders).values([
    { id: "f-tech", name: "Tech", workspaceId: A, createdAt: "2026-01-01" },
    {
      id: "f-ai",
      name: "AI",
      workspaceId: A,
      parentId: "f-tech",
      createdAt: "2026-01-02",
    },
    { id: "f-other", name: "Theirs", workspaceId: B, createdAt: "2026-01-01" },
  ])

  await db.insert(feeds).values([
    {
      id: "fd-1",
      name: "Alpha Feed",
      url: "https://a.example/rss",
      folderId: "f-tech",
      workspaceId: A,
      createdAt: "2026-01-01",
      lastFetchedAt: now,
    },
    {
      id: "fd-2",
      name: "Broken Feed",
      url: "https://b.example/rss",
      folderId: "f-ai",
      workspaceId: A,
      createdAt: "2026-01-02",
      lastError: "404",
    },
    {
      id: "fd-3",
      name: "Beta Feed",
      url: "https://c.example/rss",
      folderId: "f-other",
      workspaceId: B,
      createdAt: "2026-01-01",
      lastFetchedAt: now,
    },
  ])

  // A site with no feed, read from its listing page. An ordinary `feeds` row
  // with `kind: 'page'` — it used to be a `scraped_feeds` row in a separate id
  // space, which is why nothing could count, open or delete one.
  await db.insert(feeds).values([
    {
      id: "fd-page",
      name: "Watched Site",
      url: "https://watched.example/blog",
      kind: "page",
      folderId: "f-tech",
      workspaceId: A,
      createdAt: "2026-01-03",
      lastFetchedAt: now,
    },
  ])

  await db.insert(articles).values([
    {
      id: "a-1",
      feedId: "fd-1",
      title: "Alpha one",
      link: "https://a.example/1",
      isUsed: false,
      publishedAt: now,
      createdAt: now,
    },
    {
      id: "a-2",
      feedId: "fd-1",
      title: "Alpha two",
      link: "https://a.example/2",
      isUsed: true,
      isFavorite: true,
      publishedAt: now,
      createdAt: now,
    },
    {
      id: "a-3",
      feedId: "fd-2",
      title: "Alpha three",
      link: "https://b.example/1",
      isUsed: false,
      publishedAt: now,
      createdAt: now,
    },
    {
      id: "a-9",
      feedId: "fd-3",
      title: "Beta secret",
      link: "https://c.example/1",
      isUsed: false,
      publishedAt: now,
      createdAt: now,
    },
  ])

  await db.insert(articles).values([
    {
      id: "a-page",
      feedId: "fd-page",
      title: "A watched piece",
      link: "https://watched.example/blog/one",
      // The real gain from unifying: a page-read article carries its full
      // extracted text, where `scraped_articles` had no content column at all.
      content: "<p>The whole article body.</p>",
      description: "Body text here.",
      isUsed: false,
      publishedAt: now,
      createdAt: now,
    },
  ])
})

describe("get_workspace_info", () => {
  it("counts only this workspace, and agrees with list_feeds", async () => {
    const { getWorkspaceInfo, listFeeds } =
      await import("@/server/services/workspace")

    const info = await getWorkspaceInfo(principal(A))
    const list = await listFeeds(principal(A))

    // 2 feeds + 1 watched page. The bug this pins: the count used to include
    // watched sources while the list omitted them, so the two disagreed.
    expect(info.counts.feeds).toBe(3)
    expect(list.feeds).toHaveLength(3)
    expect(info.counts.feeds).toBe(list.feeds.length)
    expect(info.counts.feeds_scraped).toBe(1)

    expect(info.counts.folders).toBe(2)
    expect(info.counts.articles_total).toBe(4)
    expect(info.counts.unread).toBe(3)
    expect(info.counts.favorites).toBe(1)
  })

  it("surfaces feeds that need attention", async () => {
    const { getWorkspaceInfo } = await import("@/server/services/workspace")
    const info = await getWorkspaceInfo(principal(A))
    expect(info.needs_attention.map((f) => f.name)).toContain("Broken Feed")
  })

  it("never leaks another workspace", async () => {
    const { getWorkspaceInfo } = await import("@/server/services/workspace")
    const info = await getWorkspaceInfo(principal(B))
    expect(info.counts.feeds).toBe(1)
    expect(info.counts.articles_total).toBe(1)
    expect(info.busiest_feeds.map((f) => f.name)).not.toContain("Alpha Feed")
  })
})

describe("list_folders", () => {
  it("returns the tree and per-folder unread", async () => {
    const { listFolders } = await import("@/server/services/workspace")
    const { folders } = await listFolders(principal(A))

    const tech = folders.find((f) => f.name === "Tech")!
    const ai = folders.find((f) => f.name === "AI")!

    // parent_id used to be dropped, flattening the tree.
    expect(tech.parent_id).toBeNull()
    expect(ai.parent_id).toBe(tech.id)
    // Two: the RSS feed's unread article and the watched page's. A watched
    // source used to contribute nothing to any count anywhere.
    expect(tech.unread_count).toBe(2)
    expect(ai.unread_count).toBe(1)
  })

  it("excludes other workspaces", async () => {
    const { listFolders } = await import("@/server/services/workspace")
    const { folders } = await listFolders(principal(A))
    expect(folders.map((f) => f.name)).not.toContain("Theirs")
  })
})

describe("list_feeds", () => {
  it("filters by a prefixed folder id", async () => {
    const { listFeeds, listFolders } =
      await import("@/server/services/workspace")
    const { folders } = await listFolders(principal(A))
    const ai = folders.find((f) => f.name === "AI")!

    // The headline fix: the prefixed id used to be compared against the raw
    // stored id, so this filter always returned nothing.
    const { feeds } = await listFeeds(principal(A), { folderId: ai.id })
    expect(feeds).toHaveLength(1)
    expect(feeds[0].name).toBe("Broken Feed")
  })

  it("lists a watched page beside the feeds, with real numbers", async () => {
    const { listFeeds } = await import("@/server/services/workspace")
    const { feeds } = await listFeeds(principal(A))
    const watched = feeds.find((f) => f.kind === "scraped")!
    expect(watched.name).toBe("Watched Site")
    // Real counts, not null. They used to be null because `scraped_articles`
    // had no read state to report — a watched page is an ordinary source now.
    expect(watched.article_count).toBe(1)
    expect(watched.unread_count).toBe(1)
  })

  it("carries per-feed unread counts", async () => {
    const { listFeeds } = await import("@/server/services/workspace")
    const { feeds } = await listFeeds(principal(A))
    const alpha = feeds.find((f) => f.name === "Alpha Feed")!
    expect(alpha.article_count).toBe(2)
    expect(alpha.unread_count).toBe(1)
  })
})

describe("get_article", () => {
  it("reads an article from a watched page like any other", async () => {
    const { getArticle } = await import("@/server/services/articles")
    const article = await getArticle(principal(A), { id: "art_a-page" })
    expect(article.title).toBe("A watched piece")
    // The whole body, from the cached extraction. The old path could only ever
    // return the first paragraph, because `scraped_articles` had no content.
    expect(article.content).toContain("The whole article body")
    expect(article.source_quality).toBe("extracted")
  })

  it("still accepts a scr_ id left in a saved conversation", async () => {
    // The prefix decodes to the same row id; it no longer names another table.
    const { getArticle } = await import("@/server/services/articles")
    const article = await getArticle(principal(A), { id: "scr_a-page" })
    expect(article.title).toBe("A watched piece")
  })

  it("refuses an RSS article from another workspace", async () => {
    const { getArticle } = await import("@/server/services/articles")
    await expect(getArticle(principal(A), { id: "art_a-9" })).rejects.toThrow(
      /not found/i
    )
  })
})

describe("search_articles", () => {
  it("never returns another workspace's articles", async () => {
    const { searchArticles } = await import("@/server/services/articles")
    const result = await searchArticles(principal(A), {})
    expect(result.articles.map((a) => a.title)).not.toContain("Beta secret")
    // Four, including the watched page's article — which was unsearchable
    // before, living in a table search never looked at.
    expect(result.articles.map((a) => a.title)).toContain("A watched piece")
    expect(result.articles).toHaveLength(4)
  })
})

describe("write tools", () => {
  it("create_folder refuses in demo", async () => {
    const { createFolder } = await import("@/server/services/sources-write")
    await expect(
      createFolder(principal(A, { demo: true }), { name: "Nope" })
    ).rejects.toThrow(/demo/i)
  })

  it("create_folder rejects a parent from another workspace", async () => {
    const { createFolder } = await import("@/server/services/sources-write")
    await expect(
      createFolder(principal(A), { name: "Child", parentId: "fld_f-other" })
    ).rejects.toThrow(/not found/i)
  })

  it("move_feed rejects a feed from another workspace", async () => {
    const { moveFeed } = await import("@/server/services/sources-write")
    await expect(
      moveFeed(principal(A), { feedId: "fed_fd-3", folderId: null })
    ).rejects.toThrow(/not found/i)
  })

  it("move_feed relocates a feed the caller owns", async () => {
    const { moveFeed } = await import("@/server/services/sources-write")
    const { listFeeds } = await import("@/server/services/workspace")

    const result = await moveFeed(principal(A), {
      feedId: "fed_fd-2",
      folderId: "fld_f-tech",
    })
    expect(result.feed.folder_id).toBe("fld_f-tech")

    const { feeds } = await listFeeds(principal(A), { folderId: "fld_f-tech" })
    expect(feeds.map((f) => f.name)).toContain("Broken Feed")
  })
})
