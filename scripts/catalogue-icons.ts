/**
 * Fetches an icon for every catalogue source and commits it to public/catalogue/.
 *
 *   bun scripts/catalogue-icons.ts              # fetch anything missing
 *   bun scripts/catalogue-icons.ts --force      # re-fetch, overwriting
 *   bun scripts/catalogue-icons.ts --only=ai    # one category, or one slug
 *
 * Why fetch at all, rather than pointing an <img> at a favicon service: that
 * would make a third-party request from every visitor's browser, telling
 * someone else which sources our users browse. /privacy states there are no
 * undisclosed third-party calls. Fetching once here and serving from our own
 * origin keeps that true, and survives the source going down.
 *
 * Written to public/catalogue/, NOT src/public/ — Vite serves <root>/public,
 * and src/public/ is committed but never served.
 *
 * A missing icon is a design state, not a failure: SourceIcon falls back to a
 * gradient with the source's initials. So this exits 0 even with misses, and
 * prints the slugs it could not resolve so a curator can drop in an SVG by hand.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as cheerio from 'cheerio'

const ROOT = process.cwd()
const CATALOGUE_PATH = join(ROOT, 'src/config/catalogue.json')
const ICON_DIR = join(ROOT, 'public/catalogue')
const CONCURRENCY = 5
const TIMEOUT_MS = 10_000
const MIN_BYTES = 200

const args = process.argv.slice(2)
const FORCE = args.includes('--force')
const ONLY = args.find((a) => a.startsWith('--only='))?.slice('--only='.length)

interface FeedEntry {
  slug: string
  name: string
  siteUrl?: string
  url?: string
  icon?: string
}
interface Item extends FeedEntry {
  kind: 'collection' | 'feed'
  cover?: string
  feeds?: FeedEntry[]
}
interface Category { slug: string; items: Item[] }
interface CatalogueFile { version: number; categories: Category[] }

const catalogue: CatalogueFile = JSON.parse(readFileSync(CATALOGUE_PATH, 'utf8'))

interface Target {
  slug: string
  name: string
  category: string
  siteUrl: string
  /** Written back as `icon` (feeds) or `cover` (collections). */
  entry: FeedEntry | Item
  field: 'icon' | 'cover'
}

const targets: Target[] = []
for (const category of catalogue.categories) {
  for (const item of category.items) {
    if (item.kind === 'collection') {
      if (item.siteUrl) {
        targets.push({ slug: item.slug, name: item.name, category: category.slug, siteUrl: item.siteUrl, entry: item, field: 'cover' })
      }
      for (const member of item.feeds ?? []) {
        const site = member.siteUrl ?? item.siteUrl
        if (site) targets.push({ slug: member.slug, name: member.name, category: category.slug, siteUrl: site, entry: member, field: 'icon' })
      }
    } else if (item.siteUrl) {
      targets.push({ slug: item.slug, name: item.name, category: category.slug, siteUrl: item.siteUrl, entry: item, field: 'icon' })
    }
  }
}

const selected = ONLY ? targets.filter((t) => t.category === ONLY || t.slug === ONLY) : targets

async function fetchWithTimeout(url: string): Promise<Response | null> {
  // Plain fetch, not safeFetch: the SSRF guard exists for URLs a user typed,
  // and safeFetchText decodes to a string, which corrupts binary.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'Sparkfeed catalogue icon fetcher' },
    })
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Candidates, best first.
 *
 * apple-touch-icon leads because it is square PNG by definition and usually
 * 180px, which means most sources need no resizing and this script needs no
 * image library.
 */
async function candidatesFor(siteUrl: string): Promise<string[]> {
  const out: string[] = []
  const origin = new URL(siteUrl).origin

  const res = await fetchWithTimeout(siteUrl)
  if (res?.ok) {
    const html = await res.text().catch(() => '')
    if (html) {
      const $ = cheerio.load(html)
      const bySize = (selector: string) =>
        $(selector)
          .toArray()
          .map((el) => ({
            href: $(el).attr('href'),
            size: parseInt($(el).attr('sizes')?.split('x')[0] ?? '0', 10) || 0,
          }))
          .filter((c) => c.href)
          .sort((a, b) => b.size - a.size)
          .map((c) => new URL(c.href!, res.url || siteUrl).href)

      out.push(...bySize('link[rel~="apple-touch-icon"]'))
      out.push(...bySize('link[rel~="icon"]'))
    }
  }

  out.push(`${origin}/apple-touch-icon.png`)
  out.push(`${origin}/favicon.ico`)
  return [...new Set(out)]
}

type Result =
  | { kind: 'written'; slug: string; from: string; bytes: number; file: string }
  | { kind: 'skipped'; slug: string; file: string }
  | { kind: 'missing'; slug: string }

async function grab(target: Target): Promise<Result> {
  const file = `${target.slug}.png`
  const dest = join(ICON_DIR, file)

  if (existsSync(dest) && !FORCE) {
    // Never silently clobber a hand-tuned icon.
    if (!(target.entry as FeedEntry).icon) (target.entry as any)[target.field] = file
    return { kind: 'skipped', slug: target.slug, file }
  }

  for (const candidate of await candidatesFor(target.siteUrl)) {
    const res = await fetchWithTimeout(candidate)
    if (!res?.ok) continue
    const type = res.headers.get('content-type') ?? ''
    if (!type.startsWith('image/')) continue

    const bytes = Buffer.from(await res.arrayBuffer())
    if (bytes.byteLength < MIN_BYTES) continue

    writeFileSync(dest, bytes)
    ;(target.entry as any)[target.field] = file
    return { kind: 'written', slug: target.slug, from: candidate, bytes: bytes.byteLength, file }
  }

  return { kind: 'missing', slug: target.slug }
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (i: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const index = cursor++
        if (index >= items.length) return
        results[index] = await fn(items[index])
      }
    }),
  )
  return results
}

async function main() {
  mkdirSync(ICON_DIR, { recursive: true })
  console.log(`Fetching icons for ${selected.length} sources at concurrency ${CONCURRENCY}.\n`)

  const results = await mapWithConcurrency(selected, CONCURRENCY, grab)

  for (const r of results) {
    if (r.kind === 'written') {
      console.log(`ok      ${r.slug.padEnd(30)} ${(r.bytes / 1024).toFixed(1)}KB  ${r.from}`)
    } else if (r.kind === 'skipped') {
      console.log(`have    ${r.slug.padEnd(30)} ${r.file}`)
    } else {
      console.log(`none    ${r.slug.padEnd(30)} falls back to gradient initials`)
    }
  }

  const written = results.filter((r) => r.kind === 'written').length
  const skipped = results.filter((r) => r.kind === 'skipped').length
  const missing = results.filter((r) => r.kind === 'missing') as Extract<Result, { kind: 'missing' }>[]

  // Write the icon/cover filenames back so the sync can find them.
  writeFileSync(CATALOGUE_PATH, `${JSON.stringify(catalogue, null, 2)}\n`)

  console.log(`\n${written} written · ${skipped} already had one · ${missing.length} without`)
  if (missing.length > 0) {
    console.log(`\nNo icon found for:\n  ${missing.map((m) => m.slug).join('\n  ')}`)
    console.log('\nThese render as gradient initials, which is a supported state. Drop a PNG')
    console.log('into public/catalogue/<slug>.png by hand if you want a real mark.')
  }
}

main().catch((err) => {
  console.error('[catalogue-icons] failed:', err)
  process.exit(1)
})
