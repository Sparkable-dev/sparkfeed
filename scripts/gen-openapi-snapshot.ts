/**
 * Writes the OpenAPI document to a file the docs site can read on its own.
 *
 * The docs are a separate Railway service that builds from `docs/` with its own
 * `bun install`. Nothing above that directory exists there — not `src/`, not the
 * root `node_modules` — so the docs build cannot import the tool registry to
 * build the spec itself, however careful its fallbacks are. That is not a
 * missing dependency to add: pulling drizzle and postgres into a documentation
 * site to render a schema would be the wrong trade.
 *
 * So the spec crosses the boundary as data. This script runs from the repo
 * root, where the registry and its dependencies do exist, and commits the
 * result. `src/server/api/__tests__/openapi-snapshot.test.ts` then asserts the
 * committed file still matches what the registry produces, so a tool added
 * without re-running this fails the suite rather than quietly shipping docs that
 * describe the previous release.
 *
 * Run: `bun run openapi:snapshot`
 */

import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { buildOpenApiDocument, SNAPSHOT_ORIGIN } from "../src/server/api/openapi"

const OUT = join(import.meta.dir, "../docs/src/data/openapi.json")

// The registry reaches the services layer, which imports the `db` singleton —
// and that module throws at import time when DATABASE_URL is unset. Nothing
// here runs a query (this reads Zod schemas and descriptions, and postgres-js
// connects lazily), so a placeholder satisfies the guard without pretending a
// database exists. Only set when the real one is absent.
process.env.DATABASE_URL ||= "postgresql://openapi-snapshot@localhost:5432/unused"

const document = buildOpenApiDocument(SNAPSHOT_ORIGIN)
await writeFile(OUT, `${JSON.stringify(document, null, 2)}\n`, "utf8")

const operations = Object.values(document.paths).reduce(
  (n, methods) => n + Object.keys(methods as object).length,
  0
)
console.log(`[openapi] wrote ${operations} operations to docs/src/data/openapi.json`)
