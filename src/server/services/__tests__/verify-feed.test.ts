import { beforeEach, describe, expect, it, vi } from "vitest"
import { feedSignals } from "../../utils/feed-signals"
import type { createClient } from "@libsql/client"
import type { Database } from "@/db/client"
import { createDb } from "@/db/client"

/**
 * `verify_feed`, without the network.
 *
 * `resolveFeed` is stubbed because what is being tested is not whether
 * rss-parser works — it does, and `detectRSS` has its own tests — but the
 * judgements this service layers on top: that a URL which is not a feed is an
 * *answer* rather than a thrown error, that the posting rate is derived
 * sensibly from whatever dates the items happened to carry, and that a feed the
 * workspace already has is marked.
 */

let db: Database
let resolved: unknown = null
let resolveThrows: Error | null = null

vi.mock("@/db/index", () => ({
  get db() {
    return db
  },
}))

vi.mock("../../utils/detectRSS", () => ({
  resolveFeed: async () => {
    if (resolveThrows) throw resolveThrows
    return resolved
  },
}))

const { verifyFeed } = await import("../discovery")

const PRINCIPAL = {
  keyId: "session",
  workspaceId: "ws-1",
  plan: "pro" as const,
  scopes: ["workspace:read" as const],
  demo: false,
}

/** Items every `days` days, newest first, as ISO strings. */
const dates = (count: number, days: number): Array<string> =>
  Array.from({ length: count }, (_, i) =>
    new Date(Date.now() - i * days * 86_400_000).toISOString()
  )

/**
 * A stubbed `resolveFeed` result.
 *
 * `signals` is computed by the real `feedSignals` from the same dates rather
 * than hand-written, so the cadence numbers these tests pin are the ones the
 * production path actually produces.
 */
function stub(over: {
  url: string
  title: string | null
  itemCount: number
  sampleTitles: Array<string>
  publishedDates: Array<string>
}) {
  const items = over.publishedDates.length
    ? over.publishedDates.map((isoDate, i) => ({
        isoDate,
        title: over.sampleTitles[i],
      }))
    : Array.from({ length: over.itemCount }, (_, i) => ({
        title: over.sampleTitles[i],
      }))

  return {
    ...over,
    signals: feedSignals({
      requestedUrl: over.url,
      finalUrl: over.url,
      feed: { title: over.title, items },
    }),
  }
}

beforeEach(async () => {
  resolved = null
  resolveThrows = null

  db = createDb(":memory:", { sqlite: true })
  const raw = (db as unknown as { $client: ReturnType<typeof createClient> })
    .$client
  await raw.execute(`CREATE TABLE feeds (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL,
    folder_id TEXT, workspace_id TEXT, kind TEXT DEFAULT 'rss', include_keywords TEXT,
    exclude_keywords TEXT, position INTEGER, created_at TEXT,
    last_fetched_at TEXT, last_error TEXT, last_error_at TEXT,
    entitlement_paused_at TEXT)`)
})

describe("an address that is not a feed", () => {
  it("comes back as an answer, not an exception", async () => {
    // The model has to be able to say "that page has no feed" and carry on. A
    // throw here would surface as a tool failure and an apology.
    const result = await verifyFeed(PRINCIPAL, {
      url: "https://example.com/about",
    })
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("No RSS or Atom feed")
    expect(result.requested_url).toBe("https://example.com/about")
  })

  it("passes an unreachable address's own message through", async () => {
    resolveThrows = new Error("That address is not publicly reachable.")
    const result = await verifyFeed(PRINCIPAL, { url: "http://127.0.0.1/feed" })
    expect(result.valid).toBe(false)
    expect(result.reason).toBe("That address is not publicly reachable.")
  })

  it("refuses in demo mode, where outbound fetching is off", async () => {
    await expect(
      verifyFeed({ ...PRINCIPAL, demo: true }, { url: "https://example.com" })
    ).rejects.toThrow(/demo/i)
  })
})

describe("a real feed", () => {
  it("reports the address that actually parsed, not the one asked for", async () => {
    // Pasting a homepage is the common case; the answer is the feed it found.
    resolved = stub({
      url: "https://example.com/feed.xml",
      title: "Example Blog",
      itemCount: 10,
      sampleTitles: ["One", "Two"],
      publishedDates: dates(10, 2),
    })

    const result = await verifyFeed(PRINCIPAL, { url: "https://example.com" })
    expect(result.valid).toBe(true)
    expect(result.url).toBe("https://example.com/feed.xml")
    expect(result.requested_url).toBe("https://example.com")
    expect(result.site_url).toBe("https://example.com")
    expect(result.title).toBe("Example Blog")
    // The signals ride along, so the chat card and the Add dialog describe the
    // same feed the same way.
    expect(result.signals?.freshness).toBe("fresh")
    expect(result.signals?.itemCount).toBe(10)
  })

  it("works out roughly how often it posts", async () => {
    // 10 items, one every two days → about 3.5/week, rounded to 4.
    resolved = stub({
      url: "https://example.com/feed.xml",
      title: "Example",
      itemCount: 10,
      sampleTitles: [],
      publishedDates: dates(10, 2),
    })
    const result = await verifyFeed(PRINCIPAL, { url: "https://example.com" })
    expect(result.posts_per_week).toBe(4)
    expect(result.last_published_at).toBeTruthy()
  })

  it("keeps a decimal for a feed that posts rarely", async () => {
    // Monthly. Rounding to a whole number would report 0 and read as dead.
    resolved = stub({
      url: "https://example.com/feed.xml",
      title: "Example",
      itemCount: 6,
      sampleTitles: [],
      publishedDates: dates(6, 30),
    })
    const result = await verifyFeed(PRINCIPAL, { url: "https://example.com" })
    expect(result.posts_per_week).toBeGreaterThan(0)
    expect(result.posts_per_week).toBeLessThan(1)
  })

  it("says nothing about cadence rather than dividing by zero", async () => {
    // Everything published the same day, or a feed with no dates at all. There
    // is no span to divide by, and "infinite posts per week" is not an answer.
    resolved = stub({
      url: "https://example.com/feed.xml",
      title: "Example",
      itemCount: 3,
      sampleTitles: [],
      publishedDates: [
        new Date().toISOString(),
        new Date().toISOString(),
        new Date().toISOString(),
      ],
    })
    expect(
      (await verifyFeed(PRINCIPAL, { url: "https://example.com" }))
        .posts_per_week
    ).toBeNull()

    resolved = stub({
      url: "https://example.com/feed.xml",
      title: "Example",
      itemCount: 3,
      sampleTitles: [],
      publishedDates: [],
    })
    const undated = await verifyFeed(PRINCIPAL, { url: "https://example.com" })
    expect(undated.posts_per_week).toBeNull()
    expect(undated.last_published_at).toBeNull()
  })

  it("marks a feed the workspace already has", async () => {
    const { feeds } = await import("@/db/schema")
    await db.insert(feeds).values({
      id: "f1",
      name: "Example",
      // Stored with a trailing slash and a different scheme on purpose: these
      // are the same feed, and offering to add it again would be wrong.
      url: "http://example.com/feed.xml/",
      workspaceId: "ws-1",
    })

    resolved = stub({
      url: "https://example.com/feed.xml",
      title: "Example",
      itemCount: 3,
      sampleTitles: [],
      publishedDates: dates(3, 1),
    })

    const result = await verifyFeed(PRINCIPAL, {
      url: "https://example.com/feed.xml",
    })
    expect(result.already_subscribed).toBe(true)
  })

  it("does not claim another workspace's subscription as this one's", async () => {
    const { feeds } = await import("@/db/schema")
    await db.insert(feeds).values({
      id: "f1",
      name: "Example",
      url: "https://example.com/feed.xml",
      workspaceId: "ws-other",
    })

    resolved = stub({
      url: "https://example.com/feed.xml",
      title: "Example",
      itemCount: 3,
      sampleTitles: [],
      publishedDates: dates(3, 1),
    })

    const result = await verifyFeed(PRINCIPAL, {
      url: "https://example.com/feed.xml",
    })
    expect(result.already_subscribed).toBe(false)
  })
})
