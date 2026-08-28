import { db } from '../src/db/index';
import { sql } from 'drizzle-orm';
async function check() {
  try {
    const tables = await db.run(sql`SELECT name FROM sqlite_master WHERE type='table'`);
    console.log(JSON.stringify(tables, null, 2));
  } catch (e) {
    console.error(e);
  }
}
check();
