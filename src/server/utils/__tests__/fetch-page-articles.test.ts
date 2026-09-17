import { beforeEach, describe, expect, it, vi } from "vitest"
import type { createClient } from "@libsql/client"
import type { Database } from "@/db/client"
import { createDb } from "@/db/client"

/**
 * Storing what a listing page has on it.
 *
 * The network is stubbed at `safeFetchText`, so what is under test is the part
 * that used to be missing rather than the extraction: that each post's own page
 * is read for its body, its picture and its date; that a post already stored is
 * not stored twice; that one unreadable post does not cost the rest; and that a
 * page which stops yielding posts is reported as broken instead of quietly
 * succeeding with nothing — the failure mode the old scraper had by design.
 */

let db: Database
const pages = new Map<string, string>()
const failing = new Set<string>()

vi.mock("@/db/index", () => ({
  get db() {
    return db
  },
}))

vi.mock("../fetch", () => ({
  safeFetchText: async (url: string) => {
    if (failing.has(url)) throw new Error("unreachable")
    const text = pages.get(url)
    if (text === undefined) return { res: { ok: false, status: 404 }, text: "" }
    return {
      res: { ok: true, status: 200 },
      text,
      contentType: "text/html",
      finalUrl: url,
    }
  },
}))

const { fetchPageArticles } = await import("../fetch-page-articles")

const LISTING = "https://example.com/blog"

const listing = (slugs: Array<string>) =>
  `<html><body>${slugs
    .map(
      (s) =>
        `<div><a href="/blog/${s}"><h3>${s.replace(/-/g, " ")}</h3></a></div>`
    )
    .join("")}</body></html>`

const article = (title: string, body: string, published?: string) =>
  `<html><head>
     <title>${title}</title>
     ${published ? `<meta property="article:published_time" content="${published}">` : ""}
     <meta property="og:image" content="/img/${title.replace(/\s/g, "-")}.jpg">
   </head><body><article><h1>${title}</h1>${body}</article></body></html>`

const LONG =
  "<p>" + "Real article prose that Readability will keep. ".repeat(20) + "</p>"

beforeEach(async () => {
  pages.clear()
  failing.clear()
  db = createDb(":memory:", { sqlite: true })
  const raw = (db as unknown as { $client: ReturnType<typeof createClient> })
    .$client
  await raw.execute(`CREATE TABLE feeds (http_etag TEXT, http_last_modified TEXT,
    id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL,
    folder_id TEXT, workspace_id TEXT, kind TEXT DEFAULT 'rss', include_keywords TEXT,
    exclude_keywords TEXT, position INTEGER, created_at TEXT,
    last_fetched_at TEXT, last_error TEXT, last_error_at TEXT,
    entitlement_paused_at TEXT)`)
  await raw.execute(`CREATE TABLE articles (source_id TEXT, source_updated_at TEXT, content_source TEXT, content_error_at TEXT,
    id TEXT PRIMARY KEY, feed_id TEXT, title TEXT NOT NULL, description TEXT,
    content TEXT, content_fetched_at TEXT, link TEXT NOT NULL, image TEXT,
    published_at TEXT, is_used INTEGER DEFAULT 0, visit_count INTEGER DEFAULT 0,
    is_bookmarked INTEGER DEFAULT 0, is_read_later INTEGER DEFAULT 0,
    is_favorite INTEGER DEFAULT 0, created_at TEXT)`)
})

async function storedArticles() {
  const { articles } = await import("@/db/schema")
  return db.select().from(articles)
}

describe("reading a listing page", () => {
  it("stores each post with the body from its own page", async () => {
    // The whole reason a post's page is fetched: a listing carries a headline
    // and a link and nothing else, so without this every article would be an
    // empty shell you had to leave the app to read.
    pages.set(
      LISTING,
      listing(["first-post-here", "second-post-here", "third-post-here"])
    )
    pages.set(
      "https://example.com/blog/first-post-here",
      article("First post here", LONG, "2026-08-01T09:00:00Z")
    )
    pages.set(
      "https://example.com/blog/second-post-here",
      article("Second", LONG)
    )
    pages.set(
      "https://example.com/blog/third-post-here",
      article("Third", LONG)
    )

    const result = await fetchPageArticles("fd-1", LISTING)
    expect(result.inserted).toBe(3)

    const rows = await storedArticles()
    const first = rows.find((r) => r.link.endsWith("first-post-here"))!
    expect(first.content).toContain("Real article prose")
    expect(first.contentFetchedAt).toBeTruthy()
    expect(first.image).toBe("https://example.com/img/First-post-here.jpg")
    expect(first.publishedAt).toBe("2026-08-01T09:00:00.000Z")
  })

  it("keeps the listing's headline over the article page's <title>", async () => {
    // A page title is usually the headline with " | Site Name" appended, and
    // Readability takes it verbatim. The listing shows what the site chose.
    pages.set(
      LISTING,
      listing(["first-post-here", "second-post-here", "third-post-here"])
    )
    for (const slug of [
      "first-post-here",
      "second-post-here",
      "third-post-here",
    ]) {
      pages.set(
        `https://example.com/blog/${slug}`,
        article("Something Else | Example Inc", LONG)
      )
    }

    await fetchPageArticles("fd-1", LISTING)
    const rows = await storedArticles()
    expect(rows.map((r) => r.title)).toContain("first post here")
  })

  it("stores a post whose own page cannot be read, minus the body", async () => {
    // A cookie wall or a 404 from a stale listing. The link and the headline
    // are already worth having; dropping the post entirely is worse.
    pages.set(
      LISTING,
      listing(["first-post-here", "second-post-here", "third-post-here"])
    )
    pages.set(
      "https://example.com/blog/first-post-here",
      article("First", LONG)
    )
    failing.add("https://example.com/blog/second-post-here")
    // third-post-here is simply absent → 404

    const result = await fetchPageArticles("fd-1", LISTING)
    expect(result.inserted).toBe(3)

    const rows = await storedArticles()
    const second = rows.find((r) => r.link.endsWith("second-post-here"))!
    expect(second.content).toBeNull()
    expect(second.title).toBe("second post here")
  })

  it("does not store a post twice", async () => {
    pages.set(
      LISTING,
      listing(["first-post-here", "second-post-here", "third-post-here"])
    )
    for (const slug of [
      "first-post-here",
      "second-post-here",
      "third-post-here",
    ]) {
      pages.set(`https://example.com/blog/${slug}`, article(slug, LONG))
    }

    await fetchPageArticles("fd-1", LISTING)
    const again = await fetchPageArticles("fd-1", LISTING)

    expect(again.inserted).toBe(0)
    expect(again.skipped).toBe(3)
    expect(await storedArticles()).toHaveLength(3)
  })

  it("only skips what this source already has", async () => {
    // Dedupe is per feed. The old scraper used a table-wide unique constraint
    // on the URL, so the second workspace to watch a site silently got nothing.
    pages.set(
      LISTING,
      listing(["first-post-here", "second-post-here", "third-post-here"])
    )
    for (const slug of [
      "first-post-here",
      "second-post-here",
      "third-post-here",
    ]) {
      pages.set(`https://example.com/blog/${slug}`, article(slug, LONG))
    }

    await fetchPageArticles("fd-1", LISTING)
    const other = await fetchPageArticles("fd-2", LISTING)
    expect(other.inserted).toBe(3)
  })
})

describe("when a page stops working", () => {
  it("retries a title-only article after its failure backoff", async () => {
    const slugs = ["first-post-here", "second-post-here", "third-post-here"]
    pages.set(LISTING, listing(slugs))
    await fetchPageArticles("fd-1", LISTING)
    const { articles } = await import("@/db/schema")
    await db.update(articles).set({ contentErrorAt: "2020-01-01T00:00:00Z" })
    for (const slug of slugs)
      pages.set(`https://example.com/blog/${slug}`, article(slug, LONG))
    await fetchPageArticles("fd-1", LISTING)
    const rows = await storedArticles()
    expect(rows).toHaveLength(3)
    expect(rows.every((row) => row.content && !row.contentErrorAt)).toBe(true)
  })
  it("persists detected links beyond the twelve-body budget", async () => {
    const slugs = Array.from({ length: 18 }, (_, i) => `article-number-${i}`)
    pages.set(LISTING, listing(slugs))
    for (const slug of slugs)
      pages.set(`https://example.com/blog/${slug}`, article(slug, LONG))
    expect((await fetchPageArticles("fd-1", LISTING)).inserted).toBe(18)
    const rows = await storedArticles()
    expect(rows.filter((row) => row.content)).toHaveLength(12)
    expect(
      rows.filter((row) => !row.content && !row.contentErrorAt)
    ).toHaveLength(6)
  })
  it("reports a listing it can no longer read posts on", async () => {
    // The old scraper's defining failure: a redesign turned it into a scrape
    // that succeeded with zero results, indistinguishable from a site that had
    // stopped posting. Throwing is what marks the source broken on /sources.
    pages.set(LISTING, "<html><body><p>We have moved.</p></body></html>")
    await expect(fetchPageArticles("fd-1", LISTING)).rejects.toThrow(
      /no posts/i
    )
  })

  it("reports a listing that will not load", async () => {
    pages.set(LISTING, "")
    pages.delete(LISTING)
    await expect(fetchPageArticles("fd-1", LISTING)).rejects.toThrow(/404/)
  })
})

it("repairs titles and missing dates without replacing saved identity or first-found time", async () => {
  const slugs = ["first-post-here", "second-post-here", "third-post-here"]
  pages.set(LISTING, listing(slugs))
  for (const slug of slugs) pages.set(`${LISTING}/${slug}`, article(slug, LONG))
  await fetchPageArticles("fd-repair", LISTING)
  const { articles } = await import("@/db/schema")
  const { eq } = await import("drizzle-orm")
  const before = (await storedArticles()).find((r) =>
    r.link.endsWith(slugs[0])
  )!
  await db
    .update(articles)
    .set({
      title: "Research",
      publishedAt: null,
      contentFetchedAt: "2020-01-01T00:00:00Z",
      createdAt: "2026-08-01T00:00:00Z",
      isFavorite: true,
    })
    .where(eq(articles.id, before.id))
  pages.set(
    `${LISTING}/${slugs[0]}`,
    article("Real article title", LONG, "2026-07-01")
  )
  await fetchPageArticles("fd-repair", LISTING)
  const after = (await storedArticles()).find((r) => r.id === before.id)!
  expect(after.title).toBe("first post here")
  expect(after.publishedAt).toBe("2026-07-01T00:00:00.000Z")
  expect(after.createdAt).toBe("2026-08-01T00:00:00Z")
  expect(Boolean(after.isFavorite)).toBe(true)
  expect(await storedArticles()).toHaveLength(3)
})

it("retains listing images when article requests fail", async () => {
  pages.set(
    LISTING,
    [1, 2, 3]
      .map(
        (i) =>
          `<a href="/blog/article-story-${i}"><img src="/cover-${i}.jpg"><h3>Real story number ${i}</h3></a>`
      )
      .join("")
  )
  await fetchPageArticles("fd-images", LISTING)
  const rows = await storedArticles()
  expect(rows).toHaveLength(3)
  expect(
    rows.every((r) => r.image?.startsWith("https://example.com/cover-"))
  ).toBe(true)
  expect(rows.every((r) => r.publishedAt === null)).toBe(true)
})

it("repairs deferred bodies after an article leaves the listing", async () => {
  pages.set(
    LISTING,
    listing(["first-post-here", "second-post-here", "third-post-here"])
  )
  await fetchPageArticles("fd-backlog", LISTING)
  const { articles } = await import("@/db/schema")
  await db.update(articles).set({ contentErrorAt: null })
  pages.set(
    LISTING,
    listing(["fourth-post-here", "fifth-post-here", "sixth-post-here"])
  )
  pages.set(
    `${LISTING}/first-post-here`,
    article("Recovered headline", LONG, "2026-07-03")
  )
  await fetchPageArticles("fd-backlog", LISTING)
  const row = (await storedArticles()).find((r) =>
    r.link.endsWith("first-post-here")
  )!
  expect(row.content).toContain("Real article prose")
  expect(row.publishedAt).toBe("2026-07-03T00:00:00.000Z")
})
