/**
 * One-off: marks migrations up to a given tag as already applied, without
 * running their SQL.
 *
 * Needed because the production database was originally created with
 * `drizzle-kit push` rather than the migrator, so its tables exist but
 * `drizzle.__drizzle_migrations` is empty. A plain `db:migrate` would try to
 * re-run 0000's CREATE TABLE statements and fail. Baselining 0000 lets the
 * migrator pick up cleanly from 0001 onwards.
 *
 * Usage:
 *   DATABASE_URL=... bun scripts/baseline.ts [tag] [--apply]
 *
 * Defaults to a dry run and to tag `0000_small_sabretooth`. Verify the live
 * schema actually matches that migration before applying.
 */
import { join } from 'node:path'
import postgres from 'postgres'
import { readMigrationFiles } from 'drizzle-orm/migrator'

const MIGRATIONS_FOLDER = join(process.cwd(), 'drizzle')
const DEFAULT_TAG = '0000_small_sabretooth'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('[baseline] DATABASE_URL is not set.')
    process.exit(1)
  }

  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const tag = args.find((a) => !a.startsWith('--')) ?? DEFAULT_TAG

  // Read the journal in order and take everything up to and including `tag`.
  // readMigrationFiles computes the same sha256 hash the migrator writes.
  const journal = JSON.parse(
    await Bun.file(join(MIGRATIONS_FOLDER, 'meta', '_journal.json')).text(),
  ) as { entries: Array<{ idx: number; tag: string; when: number }> }

  const tagIndex = journal.entries.findIndex((e) => e.tag === tag)
  if (tagIndex === -1) {
    console.error(
      `[baseline] Tag "${tag}" not found. Known tags: ${journal.entries.map((e) => e.tag).join(', ')}`,
    )
    process.exit(1)
  }

  const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER })
  const toBaseline = migrations.slice(0, tagIndex + 1)

  const client = postgres(url, { max: 1 })

  try {
    await client`CREATE SCHEMA IF NOT EXISTS "drizzle"`
    await client`
      CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `

    const existing = await client<Array<{ count: string }>>`
      select count(*)::text as count from "drizzle"."__drizzle_migrations"
    `
    if (Number(existing[0].count) > 0) {
      console.error(
        `[baseline] Refusing to run: __drizzle_migrations already has ${existing[0].count} row(s). ` +
          'This database is already tracked by the migrator; use db:migrate instead.',
      )
      process.exit(1)
    }

    console.log(`[baseline] Would mark ${toBaseline.length} migration(s) as applied:`)
    toBaseline.forEach((m, i) => {
      console.log(`  ${journal.entries[i].tag}  created_at=${m.folderMillis}  hash=${m.hash}`)
    })

    if (!apply) {
      console.log('\n[baseline] Dry run. Re-run with --apply to write these rows.')
      return
    }

    for (const m of toBaseline) {
      await client`
        insert into "drizzle"."__drizzle_migrations" ("hash", "created_at")
        values (${m.hash}, ${m.folderMillis})
      `
    }
    console.log(`\n[baseline] Done. Now run \`bun run db:migrate\` to apply the rest.`)
  } finally {
    await client.end({ timeout: 5 })
  }
}

main().catch((err) => {
  console.error('[baseline] Failed:', err)
  process.exit(1)
})
