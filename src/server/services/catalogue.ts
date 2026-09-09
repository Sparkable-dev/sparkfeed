import { and, asc, inArray, isNull, notInArray, sql } from "drizzle-orm"
import type { Database } from "@/db/client"
import { db as singleton } from "@/db/index"
import { catalogueCollections, catalogueFeeds } from "@/db/schema"
import catalogueConfig from "@/config/catalogue.json"

/**
 * The Discover catalogue: `src/config/catalogue.json` materialised into two
 * tables.
 *
 * The file is the source of truth for curation — it is reviewed in a diff and
 * ships with the repo, so a self-hosted install has a populated Discover page
 * with nothing to seed. The tables exist for the half a file cannot hold:
 * whether a feed is still alive, what it most recently published, how many
 * people imported it.
 */

// ─────────────────────────────────────────────
// THE FILE'S SHAPE
// ─────────────────────────────────────────────

interface CatalogueFeedEntry {
  sourceKind?: "rss" | "page"
  slug: string
  name: string
  description: string
  siteUrl?: string
  /**
   * Resolved feed URL. Absent until `scripts/catalogue-validate.ts --fix` has
   * run — entries are authored with `siteUrl` only, and `resolveFeed` finds the
   * real path, so nothing here is ever a hand-typed guess.
   */
  url?: string
  icon?: string
  accent?: string
}

interface CatalogueItem {
  sourceKind?: "rss" | "page"
  kind: "collection" | "feed"
  slug: string
  name: string
  description: string
  siteUrl?: string
  url?: string
  icon?: string
  cover?: string
  accent?: string
  /** Collections only. */
  feeds?: Array<CatalogueFeedEntry>
}

interface CatalogueCategory {
  slug: string
  name: string
  blurb: string
  items: Array<CatalogueItem>
}

interface CatalogueFile {
  version: number
  categories: Array<CatalogueCategory>
}

const config = catalogueConfig as CatalogueFile

/** Category metadata lives in the file, not the database — it never varies. */
export const CATEGORIES = config.categories.map((c) => ({
  slug: c.slug,
  name: c.name,
  blurb: c.blurb,
}))

// ─────────────────────────────────────────────
// FLATTENING
// ─────────────────────────────────────────────

interface FlatCollection {
  slug: string
  category: string
  name: string
  description: string
  siteUrl: string | null
  coverFile: string | null
  accent: string | null
  sortOrder: number
}

interface FlatFeed extends Omit<FlatCollection, "coverFile"> {
  sourceKind: "rss" | "page"
  collectionSlug: string | null
  feedUrl: string
  iconFile: string | null
}

/**
 * Walks the file into flat rows.
 *
 * `sortOrder` is the item's index within its category, so display order is
 * simply the order of the array — there are no sorting rules in code, and the
 * reviewable artefact is the file itself.
 *
 * **Entries with no resolved `url` are skipped**, and reported. `feed_url` is
 * NOT NULL, and an entry whose feed has never been resolved is not shippable
 * anyway — it would render a card that cannot be imported.
 */
export function flattenCatalogue(): {
  collections: Array<FlatCollection>
  feeds: Array<FlatFeed>
  unresolved: Array<string>
} {
  const collections: Array<FlatCollection> = []
  const feeds: Array<FlatFeed> = []
  const unresolved: Array<string> = []

  for (const category of config.categories) {
    category.items.forEach((item, index) => {
      if (item.kind === "collection") {
        collections.push({
          slug: item.slug,
          category: category.slug,
          name: item.name,
          description: item.description,
          siteUrl: item.siteUrl ?? null,
          coverFile: item.cover ?? null,
          accent: item.accent ?? null,
          sortOrder: index,
        })

        ;(item.feeds ?? []).forEach((member, memberIndex) => {
          if (!member.url) {
            unresolved.push(member.slug)
            return
          }
          feeds.push({
            slug: member.slug,
            category: category.slug,
            collectionSlug: item.slug,
            name: member.name,
            description: member.description,
            feedUrl: member.url,
            sourceKind: member.sourceKind ?? "rss",
            siteUrl: member.siteUrl ?? null,
            iconFile: member.icon ?? null,
            accent: member.accent ?? item.accent ?? null,
            sortOrder: memberIndex,
          })
        })
        return
      }

      if (!item.url) {
        unresolved.push(item.slug)
        return
      }
      feeds.push({
        slug: item.slug,
        category: category.slug,
        collectionSlug: null,
        name: item.name,
        description: item.description,
        feedUrl: item.url,
        sourceKind: item.sourceKind ?? "rss",
        siteUrl: item.siteUrl ?? null,
        iconFile: item.icon ?? null,
        accent: item.accent ?? null,
        sortOrder: index,
      })
    })
  }

  return { collections, feeds, unresolved }
}

// ─────────────────────────────────────────────
// SYNC
// ─────────────────────────────────────────────

/**
 * Upserts the file into the tables.
 *
 * Every `set` clause below touches **curated columns only**. The cached columns
 * — status, counts, latest headline, import count — are the database's to own.
 * Including one here would wipe it on every deploy and leave the page looking
 * dead until the next refresh.
 */
export async function syncCatalogue(db: Database): Promise<void> {
  const { collections, feeds, unresolved } = flattenCatalogue()

  if (unresolved.length > 0) {
    console.warn(
      `[catalogue] ${unresolved.length} entries have no resolved feed URL and were skipped: ` +
        `${unresolved.join(", ")}. Run: bun scripts/catalogue-validate.ts --fix`,
    )
  }

  if (collections.length > 0) {
    await db
      .insert(catalogueCollections)
      .values(collections)
      .onConflictDoUpdate({
        target: catalogueCollections.slug,
        set: {
          category: sql`excluded.category`,
          name: sql`excluded.name`,
          description: sql`excluded.description`,
          siteUrl: sql`excluded.site_url`,
          coverFile: sql`excluded.cover_file`,
          accent: sql`excluded.accent`,
          sortOrder: sql`excluded.sort_order`,
        },
      })
  }

  if (feeds.length > 0) {
    await db
      .insert(catalogueFeeds)
      .values(feeds)
      .onConflictDoUpdate({
        target: catalogueFeeds.slug,
        set: {
          category: sql`excluded.category`,
          collectionSlug: sql`excluded.collection_slug`,
          name: sql`excluded.name`,
          description: sql`excluded.description`,
          feedUrl: sql`excluded.feed_url`,
          sourceKind: sql`excluded.source_kind`,
          siteUrl: sql`excluded.site_url`,
          iconFile: sql`excluded.icon_file`,
          accent: sql`excluded.accent`,
          sortOrder: sql`excluded.sort_order`,
        },
      })
  }

  // Retire what the file no longer lists, and un-retire anything that came
  // back. Soft delete: the counters survive, and so does anything users have
  // already imported.
  const collectionSlugs = collections.map((c) => c.slug)
  const feedSlugs = feeds.map((f) => f.slug)
  const now = new Date().toISOString()

  await retireMissing(db, catalogueCollections, collectionSlugs, now)
  await retireMissing(db, catalogueFeeds, feedSlugs, now)
}

/** Shared between the two tables; both have `slug` and `retiredAt`. */
async function retireMissing(
  db: Database,

  table: any,
  liveSlugs: Array<string>,
  now: string,
): Promise<void> {
  if (liveSlugs.length === 0) {
    // An empty file would otherwise retire the entire catalogue. Refuse: this
    // is far more likely to be a broken import than a deliberate wipe.
    console.warn("[catalogue] refusing to retire everything — no live slugs")
    return
  }

  await db
    .update(table)
    .set({ retiredAt: now })
    .where(and(isNull(table.retiredAt), notInArray(table.slug, liveSlugs)))

  await db
    .update(table)
    .set({ retiredAt: null })
    .where(inArray(table.slug, liveSlugs))
}

/**
 * Runs the sync once per process, on the first read.
 *
 * Not a Nitro plugin: those must be listed explicitly in `vite.config.ts`, and
 * the comment there records how easily anything under `src/server/plugins/`
 * becomes code that never runs. Not a migration step either — `scripts/migrate.ts`
 * deliberately imports no app modules and skips demo mode entirely. A lazy latch
 * works identically in both, and is safe across replicas because the sync is a
 * pure upsert.
 *
 * Mirrors the `schemaReady` latch in `demo-seeder.ts`, except the promise is
 * cleared on failure so a transient database error does not poison the process.
 */
let syncing: Promise<void> | null = null

export function ensureCatalogueSynced(): Promise<void> {
  return (syncing ??= syncCatalogue(singleton).catch((err) => {
    syncing = null
    throw err
  }))
}

// ─────────────────────────────────────────────
// READ
// ─────────────────────────────────────────────

export interface CatalogueCardFeed {
  sourceKind?: "rss" | "page"
  slug: string
  name: string
  description: string
  feedUrl: string
  siteUrl: string | null
  iconFile: string | null
  accent: string | null
  articleCount: number | null
  latestPublishedAt: string | null
}

export type CatalogueCard =
  | ({ kind: "feed" } & CatalogueCardFeed)
  | {
      kind: "collection"
      slug: string
      name: string
      description: string
      siteUrl: string | null
      coverFile: string | null
      accent: string | null
      feeds: Array<CatalogueCardFeed>
    }

export interface CatalogueCategoryView {
  slug: string
  name: string
  blurb: string
  cards: Array<CatalogueCard>
}

/**
 * The whole catalogue, grouped for rendering.
 *
 * Retired and dead entries are dropped rather than greyed out. A greyed row
 * admits the catalogue is stale; an absent row is a catalogue that curates.
 */
export async function readCatalogue(
  db: Database = singleton,
): Promise<Array<CatalogueCategoryView>> {
  await ensureCatalogueSynced()

  const [collectionRows, feedRows] = await Promise.all([
    db
      .select()
      .from(catalogueCollections)
      .where(isNull(catalogueCollections.retiredAt))
      .orderBy(asc(catalogueCollections.sortOrder)),
    db
      .select()
      .from(catalogueFeeds)
      .where(
        and(
          isNull(catalogueFeeds.retiredAt),
          // 'unknown' is included: a freshly synced entry has never been probed
          // and is far more likely to work than not.
          notInArray(catalogueFeeds.status, ["dead"]),
        ),
      )
      .orderBy(asc(catalogueFeeds.sortOrder)),
  ])

  const toCardFeed = (f: typeof feedRows[number]): CatalogueCardFeed => ({
    slug: f.slug,
    name: f.name,
    description: f.description,
    feedUrl: f.feedUrl,
    sourceKind: f.sourceKind === "page" ? "page" : "rss",
    siteUrl: f.siteUrl,
    iconFile: f.iconFile,
    accent: f.accent,
    articleCount: f.articleCount,
    latestPublishedAt: f.latestPublishedAt,
  })

  const membersOf = new Map<string, Array<CatalogueCardFeed>>()
  for (const f of feedRows) {
    if (!f.collectionSlug) continue
    const list = membersOf.get(f.collectionSlug) ?? []
    list.push(toCardFeed(f))
    membersOf.set(f.collectionSlug, list)
  }

  return CATEGORIES.map((category) => {
    const cards: Array<CatalogueCard> = []

    for (const c of collectionRows) {
      if (c.category !== category.slug) continue
      const feeds = membersOf.get(c.slug) ?? []
      // A collection whose every member died is not a card, it is an empty
      // folder waiting to disappoint someone.
      if (feeds.length === 0) continue
      cards.push({
        kind: "collection",
        slug: c.slug,
        name: c.name,
        description: c.description,
        siteUrl: c.siteUrl,
        coverFile: c.coverFile,
        accent: c.accent,
        feeds,
      })
    }

    for (const f of feedRows) {
      if (f.category !== category.slug || f.collectionSlug) continue
      cards.push({ kind: "feed", ...toCardFeed(f) })
    }

    return { ...category, cards }
  }).filter((c) => c.cards.length > 0)
}
