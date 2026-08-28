import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The key layer is the boundary between "anyone on the internet" and a
 * workspace's data, so its branches are pinned by tests rather than by a
 * one-off manual check.
 *
 * `@/db/index` is mocked because it builds a singleton at import time and
 * throws without DATABASE_URL; these cases never reach a real query anyway.
 */

const selectMock = vi.fn()

vi.mock("@/db/index", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => selectMock() }),
      }),
    }),
    update: () => ({ set: () => ({ where: () => ({ catch: () => {} }) }) }),
  },
}))

// Demo mode is a build-time constant, so each block re-imports the module with
// the flag set the way that block needs.
async function loadKeys(demo: boolean) {
  vi.resetModules()
  vi.doMock("@/lib/demo", () => ({
    DEMO_MODE: demo,
    DEMO_WORKSPACE_ID: "demo-workspace",
  }))
  return import("../keys")
}

beforeEach(() => {
  selectMock.mockReset()
  selectMock.mockResolvedValue([])
})

afterEach(() => {
  delete process.env.MCP_DEMO_API_KEY_SHA256
})

describe("verifyApiKey — demo mode", () => {
  it("is open when no digest is configured, since the key is published anyway", async () => {
    const { verifyApiKey } = await loadKeys(true)
    const principal = await verifyApiKey("anything")
    expect(principal?.demo).toBe(true)
    expect(principal?.workspaceId).toBe("demo-workspace")
  })

  it("grants only read scopes, never write or refresh", async () => {
    const { verifyApiKey } = await loadKeys(true)
    const principal = await verifyApiKey("anything")
    expect(principal?.scopes).toContain("articles:read")
    expect(principal?.scopes).not.toContain("articles:write")
    expect(principal?.scopes).not.toContain("refresh")
  })

  it("accepts only the configured key once a digest is set", async () => {
    const { verifyApiKey, sha256 } = await loadKeys(true)
    const good = "sfk_demo_correct"
    process.env.MCP_DEMO_API_KEY_SHA256 = sha256(good)

    expect(await verifyApiKey(good)).not.toBeNull()
    expect(await verifyApiKey("sfk_demo_wrong")).toBeNull()
  })

  it("rejects an empty or whitespace token", async () => {
    const { verifyApiKey } = await loadKeys(true)
    expect(await verifyApiKey("")).toBeNull()
    expect(await verifyApiKey("   ")).toBeNull()
  })
})

describe("verifyApiKey — production", () => {
  it("never accepts a demo-prefixed key, even if one reaches the database", async () => {
    const { verifyApiKey } = await loadKeys(false)
    // Would match a row if the prefix check were missing.
    selectMock.mockResolvedValue([
      { id: "key_x", workspaceId: "ws", scopes: '["mcp"]', expiresAt: null },
    ])
    expect(await verifyApiKey("sfk_demo_leaked")).toBeNull()
  })

  it("returns null for an unknown key", async () => {
    const { verifyApiKey } = await loadKeys(false)
    selectMock.mockResolvedValue([])
    expect(await verifyApiKey("sfk_live_nope")).toBeNull()
  })

  it("rejects an expired key", async () => {
    const { verifyApiKey } = await loadKeys(false)
    selectMock.mockResolvedValue([
      {
        id: "key_x",
        workspaceId: "ws",
        scopes: '["mcp","articles:read"]',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      },
    ])
    expect(await verifyApiKey("sfk_live_expired")).toBeNull()
  })

  it("resolves a live key to its workspace and scopes", async () => {
    const { verifyApiKey } = await loadKeys(false)
    selectMock.mockResolvedValue([
      {
        id: "key_abc",
        workspaceId: "ws_real",
        scopes: '["mcp","articles:read","articles:write"]',
        expiresAt: null,
      },
    ])
    const principal = await verifyApiKey("sfk_live_good")
    expect(principal?.workspaceId).toBe("ws_real")
    expect(principal?.scopes).toContain("articles:write")
    expect(principal?.demo).toBe(false)
  })

  it("falls back to default scopes when the stored value is corrupt", async () => {
    const { verifyApiKey } = await loadKeys(false)
    selectMock.mockResolvedValue([
      { id: "key_abc", workspaceId: "ws", scopes: "not json", expiresAt: null },
    ])
    // A key that cannot be parsed must still be usable rather than silently
    // scope-less, but must never be silently escalated either.
    const principal = await verifyApiKey("sfk_live_good")
    expect(principal?.scopes).toContain("mcp")
    expect(principal?.scopes).not.toContain("refresh")
  })

  it("drops unrecognised scope strings", async () => {
    const { verifyApiKey } = await loadKeys(false)
    selectMock.mockResolvedValue([
      {
        id: "key_abc",
        workspaceId: "ws",
        scopes: '["mcp","admin:everything"]',
        expiresAt: null,
      },
    ])
    const principal = await verifyApiKey("sfk_live_good")
    expect(principal?.scopes).not.toContain("admin:everything")
  })
})

describe("sha256", () => {
  it("is stable and hex-encoded", async () => {
    const { sha256 } = await loadKeys(false)
    expect(sha256("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    )
  })
})
