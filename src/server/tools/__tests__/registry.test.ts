import { describe, expect, it } from "vitest"
import { DEFAULT_SCOPES, DEMO_SCOPES, SCOPES } from "../../api/principal"
import { TOOL_REGISTRY, allowedTools } from "../registry"
import type { ApiPrincipal } from "../../api/principal"
import { AUTONOMY_IDS } from "@/config/autonomy"

/**
 * The registry is an authorization surface, not just a list. `allowedTools` is
 * the only thing standing between a request body that claims `autonomy: "auto"`
 * and a tool that writes to the database, so these are security tests.
 */

const session = (over: Partial<ApiPrincipal> = {}): ApiPrincipal => ({
  keyId: "session",
  workspaceId: "ws-1",
  plan: "pro",
  scopes: [...DEFAULT_SCOPES, "feeds:write"],
  demo: false,
  ...over,
})

const names = (p: ApiPrincipal, a: (typeof AUTONOMY_IDS)[number]) =>
  allowedTools(p, a).map((t) => t.name)

describe("registry shape", () => {
  it("has unique tool names", () => {
    const seen = TOOL_REGISTRY.map((t) => t.name)
    expect(new Set(seen).size).toBe(seen.length)
  })

  it("declares only real scopes", () => {
    for (const tool of TOOL_REGISTRY) {
      if (tool.scope) expect(SCOPES).toContain(tool.scope)
    }
  })

  it("never exposes a writing tool at read-only autonomy", () => {
    // The invariant that makes the read-only pill trustworthy: if a tool can
    // write, its minimum autonomy must be above read-only.
    for (const tool of TOOL_REGISTRY) {
      if (!tool.annotations.readOnlyHint) {
        expect(tool.minAutonomy).not.toBe("read-only")
      }
    }
  })

  it("gives every tool a description long enough to choose by", () => {
    for (const tool of TOOL_REGISTRY) {
      expect(tool.description.length).toBeGreaterThan(40)
    }
  })
})

describe("autonomy narrows the tool set", () => {
  it("read-only yields no write tools", () => {
    const allowed = allowedTools(session(), "read-only")
    expect(allowed.length).toBeGreaterThan(0)
    expect(allowed.every((t) => t.annotations.readOnlyHint)).toBe(true)
  })

  it("auto yields every tool the session has scope for", () => {
    expect(names(session(), "auto")).toEqual(TOOL_REGISTRY.map((t) => t.name))
  })

  it("is monotonic — a higher level never removes a tool", () => {
    const read = new Set(names(session(), "read-only"))
    const ask = new Set(names(session(), "ask"))
    const auto = new Set(names(session(), "auto"))
    for (const name of read) expect(ask.has(name)).toBe(true)
    for (const name of ask) expect(auto.has(name)).toBe(true)
  })
})

describe("scopes are the ceiling", () => {
  it("a demo principal gets no write tools at any autonomy", () => {
    // The important one. A client can send whatever autonomy it likes; demo
    // holds no write scope, so the answer must not change.
    for (const autonomy of AUTONOMY_IDS) {
      const allowed = allowedTools(
        session({ scopes: DEMO_SCOPES, demo: true }),
        autonomy
      )
      expect(allowed.every((t) => t.annotations.readOnlyHint)).toBe(true)
    }
  })

  it("withholding feeds:write removes exactly the source-writing tools", () => {
    const withoutFeeds = names(session({ scopes: [...DEFAULT_SCOPES] }), "auto")
    expect(withoutFeeds).not.toContain("add_feed")
    expect(withoutFeeds).not.toContain("create_folder")
    expect(withoutFeeds).not.toContain("move_feed")
    // articles:write is still present, so curation survives.
    expect(withoutFeeds).toContain("mark_read")
  })

  it("a principal with no scopes gets nothing", () => {
    expect(allowedTools(session({ scopes: [] }), "auto")).toHaveLength(0)
  })
})

describe("the tools the user asked for exist", () => {
  it.each([
    "get_workspace_info",
    "list_folders",
    "list_feeds",
    "search_articles",
    "get_article",
    "find_feeds",
    "add_feed",
    "create_folder",
    "move_feed",
    "mark_read",
    "set_favorite",
  ])("%s is registered", (name) => {
    expect(TOOL_REGISTRY.map((t) => t.name)).toContain(name)
  })

  it("does not add a feed-items tool that overlaps search_articles", () => {
    expect(TOOL_REGISTRY.map((t) => t.name)).not.toContain("get_feed_items")
  })
})
