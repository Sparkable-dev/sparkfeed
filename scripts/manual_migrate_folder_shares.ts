import { db } from '../src/db/index';
import { sql } from 'drizzle-orm';

async function migrate() {
  try {
    console.log('Creating folder_shares table...');
    await db.run(sql`CREATE TABLE IF NOT EXISTS folder_shares (
      folder_id TEXT PRIMARY KEY NOT NULL,
      is_shared INTEGER DEFAULT 0 NOT NULL,
      password TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (folder_id) REFERENCES folders(id) ON UPDATE NO ACTION ON DELETE NO ACTION
    )`);

    console.log('Manual migration complete!');
  } catch (e) {
    console.error('Manual migration failed:', e);
  }
}

migrate();
