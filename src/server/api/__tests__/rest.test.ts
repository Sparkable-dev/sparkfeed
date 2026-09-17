import { describe, expect, it } from "vitest"
import { TOOL_REGISTRY } from "../../tools/registry"
import { buildOpenApiDocument } from "../openapi"
import {
  allowedMethodsFor,
  coerceQuery,
  errorPayload,
  matchRoute,
  pathExists,
} from "../rest"
import { ServiceError, notFound } from "../../services/errors"

const q = (s: string) => coerceQuery(new URLSearchParams(s))

describe("route matching", () => {
  it("resolves every registered endpoint", () => {
    for (const tool of TOOL_REGISTRY) {
      // Substitute a value for any {param} so the concrete path is matchable.
      const concrete = tool.http.path.replace(/\{[^}]+\}/g, "sample_id")
      const match = matchRoute(tool.http.method, concrete)
      expect(match?.tool.name, `${tool.http.method} ${concrete}`).toBe(
        tool.name
      )
    }
  })

  it("prefers a static segment over a parameterised one", () => {
    // The trap: /articles/read is a real endpoint, and /articles/{id} would
    // happily swallow it, turning "mark these read" into "fetch the article
    // called read".
    expect(matchRoute("POST", "/articles/read")?.tool.name).toBe("mark_read")
    expect(matchRoute("GET", "/articles/art_123")?.tool.name).toBe(
      "get_article"
    )
  })

  it("captures path parameters", () => {
    expect(matchRoute("GET", "/articles/art_123")?.pathParams).toEqual({
      id: "art_123",
    })
  })

  it("tolerates a trailing slash", () => {
    expect(matchRoute("GET", "/feeds/")?.tool.name).toBe("list_feeds")
  })

  it("does not match an unknown path", () => {
    expect(matchRoute("GET", "/nope")).toBeNull()
    expect(pathExists("/nope")).toBe(false)
  })

  it("knows when a path exists under another verb", () => {
    // This is what turns a POST to a GET-only endpoint into a 405 with Allow,
    // rather than a 404 that reads as "no such endpoint".
    expect(matchRoute("POST", "/workspace")).toBeNull()
    expect(pathExists("/workspace")).toBe(true)
    expect(allowedMethodsFor("/feeds").sort()).toEqual(["GET", "POST"])
  })
})

describe("query coercion", () => {
  it("converts unambiguous numbers and booleans", () => {
    expect(q("limit=20")).toEqual({ limit: 20 })
    expect(q("unread_only=true&favorites_only=false")).toEqual({
      unread_only: true,
      favorites_only: false,
    })
  })

  it("leaves anything ambiguous as a string, so Zod reports it", () => {
    // The failure this guards: Number("abc") is NaN, which slips past a
    // `z.number()` check in some setups and reaches the database as LIMIT NaN.
    expect(q("limit=abc")).toEqual({ limit: "abc" })
    expect(q("limit=12abc")).toEqual({ limit: "12abc" })
    expect(q("limit=")).toEqual({ limit: "" })
    expect(q("q=true story")).toEqual({ q: "true story" })
  })

  it("does not mangle ids that look numeric-adjacent", () => {
    expect(q("folder_id=fld_123")).toEqual({ folder_id: "fld_123" })
  })

  it("collects repeated keys into an array", () => {
    expect(q("article_ids=a&article_ids=b")).toEqual({
      article_ids: ["a", "b"],
    })
  })

  it("handles negative and decimal numbers", () => {
    expect(q("offset=-5&ratio=1.5")).toEqual({ offset: -5, ratio: 1.5 })
  })
})

describe("error mapping", () => {
  it("passes a ServiceError through with the right status", () => {
    expect(errorPayload(notFound("Article")).status).toBe(404)
    expect(errorPayload(new ServiceError("forbidden", "no")).status).toBe(403)
    expect(errorPayload(new ServiceError("rate_limited", "slow")).status).toBe(
      429
    )
  })

  it("keeps ServiceError detail fields on the wire", () => {
    const err = new ServiceError("rate_limited", "slow", {
      retry_after_ms: 500,
    })
    expect(errorPayload(err).body.error).toMatchObject({ retry_after_ms: 500 })
  })

  it("flattens an unexpected error rather than leaking it", () => {
    const { status, body } = errorPayload(
      new Error("connect ECONNREFUSED 10.0.0.5:5432")
    )
    expect(status).toBe(500)
    expect(body.error.code).toBe("internal_error")
    expect(JSON.stringify(body)).not.toContain("ECONNREFUSED")
  })
})

describe("openapi document", () => {
  const doc = buildOpenApiDocument("https://example.test") as any

  it("is 3.1 and describes every tool exactly once", () => {
    expect(doc.openapi).toBe("3.1.0")
    const operationIds = Object.values(doc.paths).flatMap((methods: any) =>
      Object.values(methods).map((op: any) => op.operationId)
    )
    expect(operationIds.sort()).toEqual(TOOL_REGISTRY.map((t) => t.name).sort())
  })

  it("declares bearer auth and the per-operation scope", () => {
    expect(doc.components.securitySchemes.bearerAuth.scheme).toBe("bearer")
    expect(doc.paths["/feeds"].post.security[0].bearerAuth).toEqual([
      "feeds:write",
    ])
    expect(doc.paths["/feeds"].get.security[0].bearerAuth).toEqual([
      "workspace:read",
    ])
  })

  it("puts read parameters in the query and write fields in the body", () => {
    const listFeeds = doc.paths["/feeds"].get
    expect(listFeeds.parameters.map((p: any) => p.name).sort()).toEqual([
      "folder_id",
      "limit",
    ])
    expect(listFeeds.requestBody).toBeUndefined()

    const addFeed = doc.paths["/feeds"].post
    expect(
      Object.keys(
        addFeed.requestBody.content["application/json"].schema.properties
      ).sort()
    ).toEqual(["allow_scrape", "folder_id", "name", "url"])
  })

  it("marks a path parameter as in:path and required", () => {
    const getArticle = doc.paths["/articles/{id}"].get
    const id = getArticle.parameters.find((p: any) => p.name === "id")
    expect(id.in).toBe("path")
    expect(id.required).toBe(true)
    // And it must not also appear in a body, or it would be documented twice.
    expect(getArticle.requestBody).toBeUndefined()
  })

  it("carries the field descriptions written in the registry", () => {
    const folderId = doc.paths["/feeds"].get.parameters.find(
      (p: any) => p.name === "folder_id"
    )
    expect(folderId.description).toContain("fld_")
  })

  it("documents the failure responses a caller must handle", () => {
    // Indexed rather than Object.values: `doc` is `any`, so values() widens to
    // unknown and needs a cast that the linter then calls redundant.
    for (const path of Object.keys(doc.paths)) {
      for (const method of Object.keys(doc.paths[path])) {
        const op = doc.paths[path][method]
        expect(Object.keys(op.responses), `${method} ${path}`).toEqual(
          expect.arrayContaining(["200", "400", "401", "403", "429"])
        )
      }
    }
  })
})
