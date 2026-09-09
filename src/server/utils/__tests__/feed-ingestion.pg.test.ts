import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { eq, inArray } from "drizzle-orm"
import type { Database } from "@/db/client"
import { createDb } from "@/db/client"
import { articles, feeds, personalFavorites, user } from "@/db/schema"

let database: Database
const request = vi.hoisted(() => vi.fn())
vi.mock("@/db/index", () => ({
  get db() {
    return database
  },
}))
vi.mock("@/server/entitlements/ingestion", () => ({
  canIngestFeed: async () => true,
}))
vi.mock("../fetch", async () => ({
  ...(await vi.importActual("../fetch")),
  safeFetchText: request,
}))
const { fetchAndInsertArticles } = await import("../fetch-articles")
const id = `feed-qa-${randomUUID()}`
const owner = `${id}-user`
const xml = (link: string, title = "An old article", guid = "stable-id") =>
  `<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>Test</title><description>Test feed</description><link>https://example.test</link><item><title>${title}</title><guid isPermaLink="false">${guid}</guid><link>${link}</link><pubDate>Wed, 01 Jan 2020 00:00:00 GMT</pubDate><content:encoded><![CDATA[<p>Saved full text</p><script>alert(1)</script>]]></content:encoded><media:content type="image/jpeg" url="https://example.test/image.jpg"/></item></channel></rss>`
const respond = (text: string, etag = "v1", status = 200) =>
  request.mockResolvedValue({
    text,
    contentType: "application/rss+xml",
    finalUrl: "https://example.test/feed",
    res: new Response(status === 304 ? null : text, {
      status,
      headers: { etag },
    }),
  })

describe.runIf(process.env.RUN_READER_POSTGRES_TESTS === "true")(
  "feed reliability on PostgreSQL",
  () => {
    beforeAll(async () => {
      const url = process.env.DATABASE_URL
      if (!url || !new URL(url).pathname.endsWith("_qa"))
        throw new Error("Use disposable *_qa database")
      database = createDb(url)
      await database
        .insert(user)
        .values({ id: owner, name: "QA", email: `${owner}@example.test` })
      await database
        .insert(feeds)
        .values({
          id,
          name: "QA",
          url: "https://example.test/feed",
          workspaceId: owner,
        })
      await database
        .insert(articles)
        .values({
          id: `${id}-old`,
          feedId: id,
          title: "Legacy title",
          link: "https://example.test/old",
          isFavorite: true,
        })
      await database
        .insert(personalFavorites)
        .values({ userId: owner, articleId: `${id}-old` })
    })
    afterAll(async () => {
      if (!database) return
      const rows = await database
        .select({ id: articles.id })
        .from(articles)
        .where(eq(articles.feedId, id))
      if (rows.length)
        await database.delete(personalFavorites).where(
          inArray(
            personalFavorites.articleId,
            rows.map((r) => r.id)
          )
        )
      await database.delete(articles).where(eq(articles.feedId, id))
      await database.delete(feeds).where(eq(feeds.id, id))
      await database.delete(user).where(eq(user.id, owner))
    })
    it("adopts legacy rows, sanitizes content, and preserves both kinds of favorite", async () => {
      respond(xml("https://example.test/old"))
      const result = await fetchAndInsertArticles(
        id,
        "https://example.test/feed"
      )
      expect(result.inserted).toBe(0)
      const [row] = await database
        .select()
        .from(articles)
        .where(eq(articles.feedId, id))
      expect(row.id).toBe(`${id}-old`)
      expect(row.sourceId).toBe("stable-id")
      expect(row.isFavorite).toBe(true)
      expect(row.content).toBe("<p>Saved full text</p>")
      expect(
        await database
          .select()
          .from(personalFavorites)
          .where(eq(personalFavorites.articleId, row.id))
      ).toHaveLength(1)
    })
    it("updates a changed publisher URL in place", async () => {
      respond(xml("https://example.test/new", "Updated title"), "v2")
      await fetchAndInsertArticles(id, "https://example.test/feed")
      const rows = await database
        .select()
        .from(articles)
        .where(eq(articles.feedId, id))
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        id: `${id}-old`,
        title: "Updated title",
        link: "https://example.test/new",
        isFavorite: true,
      })
    })
    it("uses conditional requests without parsing a 304 as an empty feed", async () => {
      respond("", "v2", 304)
      expect(
        await fetchAndInsertArticles(id, "https://example.test/feed")
      ).toEqual({ inserted: 0, skipped: 0, failed: 0 })
      expect(request.mock.lastCall?.[1].headers["If-None-Match"]).toBe("v2")
      expect(
        await database.select().from(articles).where(eq(articles.feedId, id))
      ).toHaveLength(1)
    })
    it("imports old entries on first sight, with concurrent GUID deduplication", async () => {
      respond(
        xml(
          "https://example.test/another",
          "Another old article",
          "another-id"
        ),
        "v3"
      )
      await Promise.all([
        fetchAndInsertArticles(id, "https://example.test/feed"),
        fetchAndInsertArticles(id, "https://example.test/feed"),
      ])
      expect(
        await database.select().from(articles).where(eq(articles.feedId, id))
      ).toHaveLength(2)
    })
    it("does not commit validators for an invalid successful HTTP response", async () => {
      respond("<html>Checking your browser</html>", "bad")
      await expect(
        fetchAndInsertArticles(id, "https://example.test/feed")
      ).rejects.toThrow()
      const [state] = await database
        .select()
        .from(feeds)
        .where(eq(feeds.id, id))
      expect(state.httpEtag).toBe("v3")
      expect(state.lastError).toBeTruthy()
    })
  }
)
