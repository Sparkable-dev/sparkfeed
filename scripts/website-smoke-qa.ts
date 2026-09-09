/** Live ingestion smoke test. Requires a disposable *_qa database and Community mode.
 * DATABASE_URL=... SPARKFEED_EDITION=community bun scripts/website-smoke-qa.ts
 * --only=slug limits the run. Never use a customer database.
 */
import { randomUUID } from "node:crypto"
import { eq, inArray } from "drizzle-orm"
import catalogue from "../src/config/catalogue.json"
import { db } from "../src/db/index"
import { articles, feeds, personalFavorites, user } from "../src/db/schema"
import { ingestSource } from "../src/server/utils/fetch-page-articles"
import { mapWithConcurrency } from "../src/server/utils/concurrency"

const url = process.env.DATABASE_URL
if (
  !url ||
  !new URL(url).pathname.endsWith("_qa") ||
  !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname) ||
  process.env.SPARKFEED_EDITION !== "community"
)
  throw new Error("Local disposable *_qa database and Community mode required")
const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7)
const entries = catalogue.categories
  .flatMap((category) => category.items)
  .filter(
    (item) =>
      "sourceKind" in item &&
      item.sourceKind === "page" &&
      (!only || item.slug === only)
  )
const owner = `website-smoke-${randomUUID()}`
if (!entries.length)
  throw new Error("No website sources matched the requested scope")
await db
  .insert(user)
  .values({ id: owner, name: "Website QA", email: `${owner}@example.test` })
let failures = 0
try {
  await mapWithConcurrency(entries, 2, async (entry) => {
    if (!("url" in entry) || !entry.url) throw new Error("Missing source URL")
    const feedId = `${owner}-${entry.slug}`
    try {
      await db.insert(feeds).values({
        id: feedId,
        name: entry.name,
        url: entry.url,
        kind: "page",
        workspaceId: owner,
      })
      const first = await ingestSource(feedId, entry.url, "page")
      const before = await db
        .select()
        .from(articles)
        .where(eq(articles.feedId, feedId))
      const readable = before.find((a) => a.content && a.content.length > 200)
      if (first.failed || !readable)
        throw new Error("No readable stored article, or insertion failed")
      await db
        .insert(personalFavorites)
        .values({ userId: owner, articleId: readable.id })
      await db
        .update(articles)
        .set({ isFavorite: true })
        .where(eq(articles.id, readable.id))
      const second = await ingestSource(feedId, entry.url, "page")
      const after = await db
        .select()
        .from(articles)
        .where(eq(articles.feedId, feedId))
      if (
        second.failed ||
        new Set(after.map((a) => a.link)).size !== after.length
      )
        throw new Error("Repeat refresh failed or duplicated articles")
      if (!after.find((a) => a.id === readable.id)?.isFavorite)
        throw new Error("Workspace favorite lost")
      const saved = await db
        .select()
        .from(personalFavorites)
        .where(eq(personalFavorites.articleId, readable.id))
      if (saved.length !== 1) throw new Error("Personal favorite lost")
      console.log(
        `PASS ${entry.slug}: ${before.length} stored, ${before.filter((a) => a.content).length} readable; repeat refresh and favorites retained`
      )
    } catch (error) {
      failures++
      console.log(
        `FAIL ${entry.slug}: ${error instanceof Error ? error.message.split("\n")[0] : "unknown error"}`
      )
    } finally {
      const ids = await db
        .select({ id: articles.id })
        .from(articles)
        .where(eq(articles.feedId, feedId))
      if (ids.length)
        await db.delete(personalFavorites).where(
          inArray(
            personalFavorites.articleId,
            ids.map((a) => a.id)
          )
        )
      await db.delete(articles).where(eq(articles.feedId, feedId))
      await db.delete(feeds).where(eq(feeds.id, feedId))
    }
  })
} finally {
  await db.delete(user).where(eq(user.id, owner))
  await (
    db as unknown as {
      $client: { end: (options: { timeout: number }) => Promise<void> }
    }
  ).$client.end({ timeout: 5 })
}
console.log(
  `${entries.length - failures}/${entries.length} website workflows passed; QA rows removed`
)
process.exitCode = failures ? 1 : 0
