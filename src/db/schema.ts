// PostgreSQL schema is the canonical source of truth for all environments.
// Demo mode uses the same table definitions at runtime (identical table/column names);
// the SQLite client accepts PG table objects because the query builder is db-agnostic.
// The original SQLite definitions are preserved in schema.sqlite.ts for reference.
export * from './schema.pg'
