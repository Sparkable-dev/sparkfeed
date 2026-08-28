import { db } from '../src/db/index';
import { sql } from 'drizzle-orm';

async function migrate() {
  try {
    console.log('Creating scraped_feeds table...');
    await db.run(sql`CREATE TABLE IF NOT EXISTS scraped_feeds (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      folder_id TEXT,
      site_url TEXT NOT NULL UNIQUE,
      title TEXT,
      last_hash TEXT,
      created_at INTEGER
    )`);

    console.log('Creating scraped_articles table...');
    await db.run(sql`CREATE TABLE IF NOT EXISTS scraped_articles (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      folder_id TEXT,
      site_url TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      date TEXT,
      description TEXT,
      created_at INTEGER
    )`);

    console.log('Manual migration complete!');
  } catch (e) {
    console.error('Manual migration failed:', e);
  }
}

migrate();
