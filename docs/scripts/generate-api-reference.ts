/**
 * Generates the API Reference pages from the OpenAPI document.
 *
 * The pages are build artefacts, not source: they are gitignored and rewritten
 * on every build. That is the whole point — this repo's docs spent a release
 * promising a REST API that did not exist, because the prose and the code had
 * no connection. Now a tool added to `src/server/tools/registry.ts` becomes an
 * endpoint, an operation in the spec, and a page here, with nothing to
 * remember.
 *
 * The spec is looked for in three places, in descending order of freshness:
 * a running app, the registry imported in-process, and a committed snapshot.
 * All three exist because the docs are built in three quite different places
 * — see `loadSpec`.
 *
 * Run: `bun scripts/generate-api-reference.ts`
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

const OUT_DIR = join(import.meta.dir, "../src/content/docs/api-reference")
const SNAPSHOT = join(import.meta.dir, "../src/data/openapi.json")
const SPEC_URL = process.env.SPARKFEED_OPENAPI_URL ?? "http://localhost:3000/api/v1/openapi.json"

interface Operation {
  operationId: string
  summary: string
  description: string
  tags?: Array<string>
  parameters?: Array<{
    name: string
    in: string
    required?: boolean
    description?: string
    schema: Record<string, any>
  }>
  requestBody?: {
    required?: boolean
    content: Record<string, { schema: { properties?: Record<string, any>; required?: Array<string> } }>
  }
  responses: Record<string, { description: string }>
  "x-scope"?: string
  "x-read-only"?: boolean
}

type Spec = {
  info: { title: string; version: string; description: string }
  paths: Record<string, Record<string, Operation>>
}

async function loadSpec(): Promise<Spec> {
  // A running app is the best source: it is the same document real clients get.
  try {
    const res = await fetch(SPEC_URL, { signal: AbortSignal.timeout(2000) })
    if (res.ok) {
      console.log(`[api-reference] spec from ${SPEC_URL}`)
      return (await res.json()) as Spec
    }
  } catch {
    // Nothing listening — build it in-process instead.
  }

  /*
    Second: build it from the registry. This works from a checkout of the whole
    repo — a contributor editing prose, with no app running and no database.

    Importing the registry reaches the services layer, which imports the `db`
    singleton, and that module throws at *import time* when DATABASE_URL is
    unset. Nothing here runs a query (it reads Zod schemas and descriptions, and
    postgres-js connects lazily), so a placeholder satisfies the guard without
    pretending a database exists. Only set when the real one is absent, so a
    developer with a live DATABASE_URL is unaffected.
  */
  try {
    process.env.DATABASE_URL ||= "postgresql://docs-build@localhost:5432/unused"
    const { buildOpenApiDocument, SNAPSHOT_ORIGIN } = await import(
      "../../src/server/api/openapi"
    )
    console.log("[api-reference] no server reachable; built the spec from the registry")
    return buildOpenApiDocument(SNAPSHOT_ORIGIN) as unknown as Spec
  } catch {
    // Expected in production. See below.
  }

  /*
    Third: the committed snapshot.

    The docs deploy is its own Railway service with `docs/` as its root and its
    own `bun install`, so *nothing above this directory exists there* — not
    `src/`, not the root `node_modules`. The import above cannot resolve, and no
    amount of care in this script changes that; adding drizzle and postgres to a
    documentation site to render a schema would be the wrong fix.

    So the spec crosses that boundary as data, written by `bun run
    openapi:snapshot` at the repo root and kept honest by a test there. This is
    the path production actually takes.

    This branch is deliberately not wrapped in a try: if the snapshot is missing
    the docs must fail loudly rather than publish a reference with no endpoints
    in it.
  */
  console.log("[api-reference] no app source; using the committed snapshot")
  return JSON.parse(await readFile(SNAPSHOT, "utf8")) as Spec
}

/** `/articles/{id}` + GET → `articles-id/get`, matching the sidebar slugs. */
function slugFor(path: string, method: string): string {
  const segments = path
    .split("/")
    .filter(Boolean)
    .map((s) => (s.startsWith("{") ? s.slice(1, -1) : s))
  return `${segments.join("-")}/${method}`
}

function escapeYaml(value: string): string {
  return value.replace(/"/g, '\\"')
}

/** One line per parameter, as a GFM table (remarkGfm is enabled in the config). */
function parameterTable(op: Operation): string {
  const rows: Array<[string, string, string, string]> = []

  for (const p of op.parameters ?? []) {
    rows.push([
      p.name,
      p.schema.type ?? "string",
      p.required ? "yes" : "no",
      p.description ?? (p.in === "path" ? "Path parameter." : ""),
    ])
  }

  const body = op.requestBody?.content["application/json"]?.schema
  for (const [name, prop] of Object.entries(body?.properties ?? {})) {
    rows.push([
      name,
      (prop as any).type ?? "string",
      body?.required?.includes(name) ? "yes" : "no",
      (prop as any).description ?? "",
    ])
  }

  if (rows.length === 0) return "This endpoint takes no parameters.\n"

  return [
    "| Parameter | Type | Required | Description |",
    "| --- | --- | --- | --- |",
    ...rows.map(([n, t, r, d]) => `| \`${n}\` | \`${t}\` | ${r} | ${d} |`),
  ].join("\n")
}

function page(path: string, method: string, op: Operation): string {
  const verb = method.toUpperCase()
  const variant = verb === "GET" ? "success" : verb === "PATCH" ? "caution" : "note"

  return `---
title: "${verb} ${escapeYaml(path)}"
description: "${escapeYaml(op.summary)}"
sidebar:
  badge:
    text: ${verb}
    variant: ${variant}
method: ${verb}
path: "${escapeYaml(path)}"
operationId: ${op.operationId}
---

import Playground from '../../../../components/api/Playground.astro';

${op.description}

<Playground method="${verb}" path="${path}" scope="${op["x-scope"] ?? ""}" readOnly={${op["x-read-only"] ? "true" : "false"}} />

## Parameters

${parameterTable(op)}

## Responses

| Status | Meaning |
| --- | --- |
${Object.entries(op.responses)
  .map(([code, r]) => `| \`${code}\` | ${r.description} |`)
  .join("\n")}

${op["x-scope"] ? `Requires the \`${op["x-scope"]}\` scope.` : ""}
`
}

async function main() {
  const spec = await loadSpec()

  // Wipe first: a renamed endpoint would otherwise leave its old page behind,
  // and a stale generated page outranks the spec in search.
  await rm(OUT_DIR, { recursive: true, force: true })
  await mkdir(OUT_DIR, { recursive: true })

  let count = 0
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      const file = join(OUT_DIR, `${slugFor(path, method)}.mdx`)
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, page(path, method, op), "utf8")
      count++
    }
  }

  await writeStaticPages(spec)
  console.log(`[api-reference] wrote ${count} endpoint pages + 4 guides`)
}

async function writeStaticPages(spec: Spec) {
  const write = (name: string, order: number, title: string, description: string, body: string) =>
    writeFile(
      join(OUT_DIR, `${name}.mdx`),
      `---\ntitle: ${title}\ndescription: "${escapeYaml(description)}"\nsidebar:\n  order: ${order}\n---\n\n${body}`,
      "utf8"
    )

  const endpointCount = Object.values(spec.paths).reduce(
    (n, methods) => n + Object.keys(methods).length,
    0
  )

  await write(
    "overview",
    1,
    "Overview",
    "What the Sparkfeed REST API does and where it lives.",
    `${spec.info.description}

There are ${endpointCount} endpoints. Every one is generated from the same definition that backs the MCP server, so the two cannot describe different behaviour.

## Base URL

\`\`\`
https://beta.sparkfeed.dev/api/v1
\`\`\`

The public demo workspace is at \`https://demo.sparkfeed.dev/api/v1\` and is read-only. Every page in this section has a **Send** button that calls it live.

## Machine-readable spec

\`\`\`
GET /api/v1/openapi.json
\`\`\`

OpenAPI 3.1, unauthenticated. Point your client generator at it.
`
  )

  await write(
    "authentication",
    2,
    "Authentication",
    "How to authenticate with the Sparkfeed API.",
    `Every request carries an API key as a bearer token.

\`\`\`bash
curl https://beta.sparkfeed.dev/api/v1/feeds \\
  -H "Authorization: Bearer sfk_live_..."
\`\`\`

Create a key under **Developer → API Keys** in the app. The secret is shown once.

## Scopes

A key carries scopes, and each endpoint requires one. A key without it gets a \`403\` naming the scope it needs, rather than an empty result.

| Scope | Grants | On a new key |
| --- | --- | --- |
| \`mcp\` | Use the API at all | yes |
| \`workspace:read\` | Read folders, feeds and workspace stats | yes |
| \`articles:read\` | Search and read articles | yes |
| \`articles:write\` | Mark read, set favourites | yes |
| \`feeds:write\` | Add feeds, create folders, move feeds | **no** |

:::caution[Write endpoints need a scope new keys do not have]
A key created from **Developer → API Keys** gets the four scopes above marked *yes*. It does **not** get \`feeds:write\`, so \`POST /feeds\`, \`POST /folders\` and \`PATCH /feeds/{feed_id}\` will return \`403\` until the key is minted with that scope explicitly.
:::

## The demo key

\`sfk_demo_public\` works against \`demo.sparkfeed.dev\` and holds read scopes only. It is what the **Send** buttons in these docs use, so you can try every read endpoint without signing up.

## Failing requests

A missing or invalid key returns \`401\` with a \`WWW-Authenticate\` header pointing at this deployment's resource metadata, so a client can discover how to authenticate rather than guess.
`
  )

  await write(
    "rate-limits",
    3,
    "Rate Limits",
    "Request limits and how to handle them.",
    `Limits are per key, and per client address for the shared demo key — so one noisy demo user cannot exhaust it for everyone.

Exceeding the limit returns \`429\` with a \`Retry-After\` header in seconds:

\`\`\`json
{
  "error": {
    "code": "rate_limited",
    "message": "Too many requests. Slow down and retry.",
    "retry_after_ms": 4200
  }
}
\`\`\`

Back off for \`Retry-After\` rather than retrying immediately. The MCP endpoint shares these buckets, so switching transport does not double your budget.
`
  )

  await write(
    "errors",
    4,
    "Errors",
    "The error shape and what each code means.",
    `Every failure returns the same envelope, so one handler covers all of them.

\`\`\`json
{
  "error": {
    "code": "invalid_argument",
    "message": "Some parameters are missing or the wrong type.",
    "issues": [{ "field": "limit", "message": "expected number, received string" }]
  }
}
\`\`\`

| Status | Code | Meaning |
| --- | --- | --- |
| \`400\` | \`invalid_argument\` | A parameter is missing or the wrong type. \`issues\` names the field. |
| \`401\` | — | Missing or invalid API key. |
| \`403\` | \`forbidden\` | The key lacks the scope, named in \`required_scope\`. |
| \`404\` | \`not_found\` | No such endpoint, or the resource is not in this workspace. |
| \`405\` | \`method_not_allowed\` | The path exists under a different verb; see \`Allow\`. |
| \`429\` | \`rate_limited\` | Slow down; see \`retry_after_ms\`. |
| \`500\` | \`internal_error\` | Our fault. The message is deliberately generic. |

A \`404\` does not distinguish "deleted" from "belongs to another workspace" — telling those apart would confirm which ids exist.
`
  )
}

await main()
