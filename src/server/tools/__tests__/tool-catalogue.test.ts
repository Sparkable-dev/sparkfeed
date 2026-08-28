import { describe, expect, it } from "vitest"
import { TOOL_REGISTRY } from "../registry"
import {
  ARTIFACT_MIN_AUTONOMY,
  ARTIFACT_TOOL_NAME,
} from "../../ai/artifacts"
import {
  WEB_SEARCH_MIN_AUTONOMY,
  WEB_SEARCH_TOOL_NAME,
} from "../../ai/web-search"
import type { AutonomyId } from "@/config/autonomy"
import { CAPABILITY_GROUPS, CATALOGUED_TOOLS } from "@/config/tool-catalogue"
import { AUTONOMY_RANK } from "@/config/autonomy"

/**
 * Everything the model can call, from both places it can be defined.
 *
 * The registry is not the whole list any more: `create_artifact` and
 * `web_search` are chat-only and deliberately outside it, so a check written
 * against the registry alone would flag their menu rows as claiming tools that
 * do not exist.
 */
const EVERY_TOOL: Array<{ name: string; minAutonomy: AutonomyId }> = [
  ...TOOL_REGISTRY.map((t) => ({ name: t.name, minAutonomy: t.minAutonomy })),
  { name: ARTIFACT_TOOL_NAME, minAutonomy: ARTIFACT_MIN_AUTONOMY },
  { name: WEB_SEARCH_TOOL_NAME, minAutonomy: WEB_SEARCH_MIN_AUTONOMY },
]

/**
 * The `+` menu's Tools list is a hand-written description of the registry,
 * because the client cannot import the registry itself — it reaches the
 * services layer and the database.
 *
 * This suite is what stops the two from drifting. The failure it exists to
 * prevent is quiet: a tool added to the registry ships working but undocumented,
 * or a group keeps promising a tool that was removed, and the menu confidently
 * describes an agent that no longer exists.
 *
 * It lives beside the registry rather than beside the catalogue so that the
 * person adding a tool is the person who sees it go red.
 */
describe("capability catalogue", () => {
  it("covers every tool exactly once", () => {
    expect(CATALOGUED_TOOLS.sort()).toEqual(
      EVERY_TOOL.map((t) => t.name).sort()
    )
  })

  it("claims no tool that does not exist", () => {
    const known = new Set(EVERY_TOOL.map((t) => t.name))
    for (const name of CATALOGUED_TOOLS) {
      expect(known.has(name), `unknown tool "${name}"`).toBe(true)
    }
  })

  it("states an autonomy level no looser than the tools it groups", () => {
    // The row renders "needs Ask" from the group's value, so a group claiming
    // to be readable while containing a write tool would offer a capability the
    // request is then refused.
    for (const group of CAPABILITY_GROUPS) {
      for (const name of group.tools) {
        const tool = EVERY_TOOL.find((t) => t.name === name)!
        expect(
          AUTONOMY_RANK[group.minAutonomy],
          `${group.id} vs ${name}`
        ).toBeGreaterThanOrEqual(AUTONOMY_RANK[tool.minAutonomy])
      }
    }
  })

  it("gives every group an example that would actually be sent", () => {
    for (const group of CAPABILITY_GROUPS) {
      expect(group.example.trim().length, group.id).toBeGreaterThan(20)
    }
  })
})
