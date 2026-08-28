import {  createDb, schema } from './client'
import type {Database} from './client';

/**
 * The app-wide database singleton.
 *
 * Construction lives in `./client` so that importing the factory has no side
 * effects; this module is the one place that decides which database the running
 * process talks to and fails fast if it cannot.
 */

const isDemo = import.meta.env.VITE_DEMO_MODE === 'true'

if (!isDemo && !process.env.DATABASE_URL) {
  throw new Error(
    '[db] DATABASE_URL is required. ' +
    'Set postgresql://user:pass@host:5432/dbname in your environment.'
  )
}

// Production: PostgreSQL via DATABASE_URL. Demo: a local SQLite file.
export const db: Database = isDemo
  ? createDb('file:rss-demo.db', { sqlite: true })
  : createDb(process.env.DATABASE_URL!)

export { schema, createDb }
export type { Database }
