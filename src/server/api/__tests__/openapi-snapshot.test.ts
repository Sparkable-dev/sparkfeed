import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { SNAPSHOT_ORIGIN, buildOpenApiDocument } from "../openapi"

/**
 * The docs site cannot build this document itself.
 *
 * It deploys as its own service from `docs/`, with its own install and nothing
 * above that directory, so it reads a committed snapshot instead — see
 * `scripts/gen-openapi-snapshot.ts`.
 *
 * A snapshot is only as good as the thing that notices it went stale. Without
 * this test the failure is silent and slow: a tool is added, the API serves it,
 * and the published reference keeps describing the previous release until
 * someone reads carefully enough to spot the gap. Here it is one red test with
 * the command to fix it in the message.
 */
describe("committed OpenAPI snapshot", () => {
  const snapshot = JSON.parse(
    readFileSync(join(process.cwd(), "docs/src/data/openapi.json"), "utf8")
  )

  it("matches what the registry produces", () => {
    expect(
      snapshot,
      "docs/src/data/openapi.json is stale — run `bun run openapi:snapshot`"
    ).toEqual(buildOpenApiDocument(SNAPSHOT_ORIGIN))
  })

  it("describes every endpoint, so a failed write cannot ship as an empty reference", () => {
    const operations = Object.values(
      snapshot.paths as Record<string, object>
    ).reduce((n, methods) => n + Object.keys(methods).length, 0)
    expect(operations).toBeGreaterThan(0)
  })
})
