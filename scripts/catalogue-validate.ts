/**
 * Validates every entry in src/config/catalogue.json against the real internet.
 *
 *   bun scripts/catalogue-validate.ts              # check, exit non-zero on failure
 *   bun scripts/catalogue-validate.ts --fix        # write resolved/moved URLs back
 *   bun scripts/catalogue-validate.ts --stats      # also write catalogue.stats.json
 *   bun scripts/catalogue-validate.ts --only=ai    # one category, or one slug
 *
 * Entries are authored with `siteUrl` and no feed URL. `resolveFeed` — the same
 * discovery the Add Feed dialog uses — finds the real path, so nothing in the
 * catalogue is ever a hand-typed guess. Re-running catches feeds that move or
 * die, which is the whole reason curation is checkable rather than hopeful.
 *
 * Timing: resolveFeed has a 20s budget and up to 8 fetches per entry. Seventy
 * entries run sequentially would take ten minutes; at concurrency 5 it is about
 * two. It has not hung.
 *
 * Exits non-zero when anything is DEAD, or when a URL needs rewriting and
 * --fix was not passed, so it works unchanged as a CI gate.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { resolveFeed } from '../src/server/utils/detectRSS'
import { inspectWebsite } from '../src/server/utils/website-preview'

const ROOT = process.cwd()
const CATALOGUE_PATH = join(ROOT, 'src/config/catalogue.json')
const STATS_PATH = join(ROOT, 'src/config/catalogue.stats.json')
const ICON_DIR = join(ROOT, 'public/catalogue')
const CONCURRENCY = 5
/** Matches the `line-clamp-2` on the cards; longer text is silently truncated. */
const MAX_DESCRIPTION = 140

const args = process.argv.slice(2)
const FIX = args.includes('--fix')
const STATS = args.includes('--stats')
const WEBSITES = args.includes('--websites')
const ONLY = args.find((a) => a.startsWith('--only='))?.slice('--only='.length)

interface FeedEntry {
  sourceKind?: 'rss' | 'page'
  slug: string
  name: string
  description: string
  siteUrl?: string
  url?: string
  icon?: string
  accent?: string
}
interface Item extends FeedEntry {
  kind: 'collection' | 'feed'
  cover?: string
  feeds?: FeedEntry[]
}
interface Category {
  slug: string
  name: string
  blurb: string
  items: Item[]
}
interface CatalogueFile {
  version: number
  categories: Category[]
}

const catalogue: CatalogueFile = JSON.parse(readFileSync(CATALOGUE_PATH, 'utf8'))

/** Every feed-bearing entry, flattened, with a handle to write `url` back. */
interface Target {
  slug: string
  name: string
  category: string
  entry: FeedEntry
}

const targets: Target[] = []
for (const category of catalogue.categories) {
  for (const item of category.items) {
    if (item.kind === 'collection') {
      for (const member of item.feeds ?? []) {
        targets.push({ slug: member.slug, name: member.name, category: category.slug, entry: member })
      }
    } else {
      targets.push({ slug: item.slug, name: item.name, category: category.slug, entry: item })
    }
  }
}

const selected = targets.filter((t) => (!ONLY || t.category === ONLY || t.slug === ONLY) && (!WEBSITES || t.entry.sourceKind === 'page'))

//─────────────────────────────────────────────
// LOCAL CHECKS — cheap, run before touching the network
//─────────────────────────────────────────────

const localProblems: string[] = []

// Collections plus every feed. A standalone feed is both an item and a target,
// so taking item slugs wholesale would report every one of them as a duplicate
// of itself.
const allSlugs = [
  ...catalogue.categories.flatMap((c) =>
    c.items.filter((i) => i.kind === 'collection').map((i) => i.slug),
  ),
  ...targets.map((t) => t.slug),
]
for (const [slug, count] of countBy(allSlugs)) {
  if (count > 1) localProblems.push(`duplicate slug: ${slug} (${count}×)`)
}

for (const t of targets) {
  if (t.entry.url) {
    // Only meaningful once URLs exist; duplicates mean two cards import the same feed.
    continue
  }
  if (!t.entry.siteUrl) {
    localProblems.push(`${t.slug}: has neither siteUrl nor url, nothing to resolve`)
  }
}

for (const [url, count] of countBy(targets.map((t) => t.entry.url).filter(Boolean) as string[])) {
  if (count > 1) localProblems.push(`duplicate feed URL: ${url} (${count}×)`)
}

for (const category of catalogue.categories) {
  for (const item of category.items) {
    const entries: FeedEntry[] = item.kind === 'collection' ? [item, ...(item.feeds ?? [])] : [item]
    for (const e of entries) {
      if (e.description && e.description.length > MAX_DESCRIPTION) {
        localProblems.push(
          `${e.slug}: description is ${e.description.length} chars, card clamps at ~${MAX_DESCRIPTION}`,
        )
      }
      const iconFile = e.icon ?? (item.kind === 'collection' ? item.cover : undefined)
      if (iconFile && !existsSync(join(ICON_DIR, iconFile))) {
        localProblems.push(`${e.slug}: icon "${iconFile}" is not in public/catalogue/`)
      }
    }
    if (item.kind === 'collection' && (item.feeds?.length ?? 0) > 12) {
      localProblems.push(`${item.slug}: ${item.feeds!.length} feeds, keep collections under 12`)
    }
  }
}

function countBy(values: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  return counts
}

//─────────────────────────────────────────────
// NETWORK
//─────────────────────────────────────────────

type Outcome =
  | { kind: 'ok'; warning?: string; target: Target; url: string; itemCount: number; title: string | null; ms: number }
  | { kind: 'moved'; target: Target; from: string; url: string; itemCount: number; title: string | null; ms: number }
  | { kind: 'dead'; target: Target; reason: string; ms: number }

async function check(target: Target): Promise<Outcome> {
  const input = target.entry.url ?? target.entry.siteUrl!
  const startedAt = Date.now()
  try {
    if (target.entry.sourceKind === 'page') {
      const native = await resolveFeed(input)
      if (native) throw new Error(`Native feed found at ${native.url}; use RSS instead of a website source`)
      const page = await inspectWebsite(input)
      if (!page) throw new Error('Fewer than three credible article links found')
      return { kind: 'ok', target, url: page.url, itemCount: page.itemCount, title: page.title, ms: Date.now() - startedAt,
        warning: page.quality === 'partial' ? 'Partial reader content in the four-article sample; original links remain usable' : undefined }

    }
    const resolved = await resolveFeed(input)
    const ms = Date.now() - startedAt
    if (!resolved) {
      return { kind: 'dead', target, reason: 'no parseable feed found', ms }
    }
    const previous = target.entry.url
    if (previous && previous !== resolved.url) {
      return { kind: 'moved', target, from: previous, url: resolved.url, itemCount: resolved.itemCount, title: resolved.title, ms }
    }
    if (!previous) {
      return { kind: 'moved', target, from: '(unresolved)', url: resolved.url, itemCount: resolved.itemCount, title: resolved.title, ms }
    }
    return { kind: 'ok', target, url: resolved.url, itemCount: resolved.itemCount, title: resolved.title, ms }
  } catch (err) {
    return {
      kind: 'dead',
      target,
      reason: err instanceof Error ? err.message : String(err),
      ms: Date.now() - startedAt,
    }
  }
}

/** Fixed-size worker pool; a run of dead entries must not stack up timeouts. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await fn(items[index])
    }
  })
  await Promise.all(workers)
  return results
}

async function main() {
  if (localProblems.length > 0) {
    console.error('\nProblems in the file itself:\n')
    for (const p of localProblems) console.error(`  ${p}`)
    console.error('')
    if (localProblems.some((p) => p.startsWith('duplicate'))) process.exit(1)
  }

  console.log(
    `Checking ${selected.length} ${selected.length === 1 ? 'entry' : 'entries'} at concurrency ${CONCURRENCY}. ` +
      `Each can take up to 20s, so this is not fast.\n`,
  )

  const outcomes = await mapWithConcurrency(selected, CONCURRENCY, check)

  for (const o of outcomes) {
    const secs = `${(o.ms / 1000).toFixed(1)}s`.padStart(6)
    if (o.kind === 'ok') {
      console.log(`ok    ${o.target.slug.padEnd(28)} ${String(o.itemCount).padStart(4)} items  ${secs}${o.warning ? `  WARNING: ${o.warning}` : ""}`)
    } else if (o.kind === 'moved') {
      console.log(`MOVED ${o.target.slug.padEnd(28)} ${o.from}\n      ${' '.repeat(28)} -> ${o.url}  (${o.itemCount} items) ${secs}`)
    } else {
      console.log(`DEAD  ${o.target.slug.padEnd(28)} ${o.reason}  ${secs}`)
    }
  }

  const moved = outcomes.filter((o) => o.kind === 'moved') as Extract<Outcome, { kind: 'moved' }>[]
  const dead = outcomes.filter((o) => o.kind === 'dead') as Extract<Outcome, { kind: 'dead' }>[]

  console.log(
    `\n${outcomes.length - moved.length - dead.length} ok · ${moved.length} to write · ${dead.length} dead\n`,
  )

  if (FIX && moved.length > 0) {
    // Mutating the parsed objects works because `target.entry` is a reference
    // into the same tree we serialise below, so key order is preserved and the
    // diff is one line per change.
    for (const o of moved) o.target.entry.url = o.url
    writeFileSync(CATALOGUE_PATH, `${JSON.stringify(catalogue, null, 2)}\n`)
    console.log(`Wrote ${moved.length} URLs to src/config/catalogue.json`)
  }

  if (STATS) {
    const stats: Record<string, unknown> = {}
    const checkedAt = new Date().toISOString()
    for (const o of outcomes) {
      if (o.kind === 'dead') continue
      stats[o.target.slug] = { itemCount: o.itemCount, latestTitle: o.title, checkedAt }
    }
    writeFileSync(STATS_PATH, `${JSON.stringify(stats, null, 2)}\n`)
    console.log(`Wrote stats for ${Object.keys(stats).length} entries to src/config/catalogue.stats.json`)
  }

  if (dead.length > 0) {
    console.error(`\n${dead.length} entries could not be resolved. Fix or remove them.\n`)
    process.exit(1)
  }
  if (moved.length > 0 && !FIX) {
    console.error(`\n${moved.length} URLs need writing. Re-run with --fix.\n`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('[catalogue-validate] failed:', err)
  process.exit(1)
})
