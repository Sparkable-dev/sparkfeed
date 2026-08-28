/**
 * Applies pending Drizzle migrations to the PostgreSQL database in DATABASE_URL.
 *
 * Run by `bun run db:migrate`, which railway.toml invokes before booting the
 * server. Exits non-zero on failure so a broken migration aborts the deploy
 * instead of starting the app against a schema it does not match.
 *
 * Deliberately does NOT import src/db/index.ts: that module reads
 * `import.meta.env.VITE_DEMO_MODE`, which only exists inside the Vite build.
 */
import { join } from 'node:path'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

const MIGRATIONS_FOLDER = join(process.cwd(), 'drizzle')

async function main() {
  // Demo mode runs on a bundled SQLite file and builds its own schema via
  // ensureDemoSchema() in src/server/demo-seeder.ts. Skip cleanly so the demo
  // service can share this start command.
  if (process.env.VITE_DEMO_MODE === 'true') {
    console.log('[migrate] VITE_DEMO_MODE=true, skipping Postgres migrations.')
    return
  }

  const url = process.env.DATABASE_URL
  if (!url) {
    console.error(
      '[migrate] DATABASE_URL is not set. Set it, or set VITE_DEMO_MODE=true for demo deployments.',
    )
    process.exit(1)
  }

  // Drizzle recommends a dedicated single connection for migrations.
  const client = postgres(url, { max: 1 })

  try {
    console.log(`[migrate] Applying migrations from ${MIGRATIONS_FOLDER}`)
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER })
    console.log('[migrate] Database is up to date.')
  } finally {
    await client.end({ timeout: 5 })
  }
}

/**
 * Drizzle wraps driver errors in DrizzleQueryError, whose own `message` is the
 * failed SQL and whose `code` is undefined. The PostgresError carrying 42P07
 * sits on `.cause`, sometimes more than one level down, so the chain has to be
 * walked rather than the top-level error inspected.
 */
function isDuplicateTable(err: unknown): boolean {
  let current: any = err
  for (let depth = 0; current && depth < 5; depth++) {
    if (current.code === '42P07') return true
    if (/already exists/i.test(String(current.message ?? ''))) return true
    current = current.cause
  }
  return false
}

main().catch((err) => {
  // 42P07 = duplicate_table. Almost always means the schema was created with
  // `drizzle-kit push`, which does not record anything in
  // drizzle.__drizzle_migrations, so the migrator considers 0000 unapplied and
  // tries to CREATE TABLE over live tables. The stack trace alone sends you
  // looking for a bad migration instead of at the journal.
  if (isDuplicateTable(err)) {
    console.error(
      '\n[migrate] The database already has these tables, but the migration journal is empty.\n' +
        '[migrate] This happens when the schema was first created with `db:push`.\n' +
        '[migrate] Mark the existing migrations as applied, then deploy again:\n' +
        '[migrate]\n' +
        '[migrate]     bun run db:baseline              # dry run, shows what it would mark\n' +
        '[migrate]     bun run db:baseline -- --apply\n' +
        '[migrate]\n' +
        '[migrate] Or, if the data is disposable, drop the schema and let migrations rebuild it.\n',
    )
  }
  console.error('[migrate] Migration failed:', err)
  process.exit(1)
})
