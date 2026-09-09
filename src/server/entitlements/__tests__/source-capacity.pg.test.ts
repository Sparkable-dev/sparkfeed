import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import type { Database } from "@/db/client"
import { createDb } from "@/db/client"
import { feeds, user } from "@/db/schema"

let database: Database
let capacity: number | null = 1
vi.mock("@/db/index", () => ({
  get db() {
    return database
  },
}))
vi.mock("../resolve", () => ({
  resolveEntitlements: async () => ({
    accessState: "active",
    sourceUnitCapacity: capacity,
  }),
}))
const { withNoRssSourceCapacity } = await import("../enforce")
const id = `capacity-qa-${randomUUID()}`

describe.runIf(process.env.RUN_READER_POSTGRES_TESTS === "true")(
  "atomic source capacity",
  () => {
    beforeAll(async () => {
      const url = process.env.DATABASE_URL
      if (!url || !new URL(url).pathname.endsWith("_qa"))
        throw new Error("Use disposable *_qa database")
      database = createDb(url)
      await database
        .insert(user)
        .values({ id, name: "QA", email: `${id}@example.test` })
    })
    afterAll(async () => {
      if (!database) return
      await database.delete(feeds).where(eq(feeds.workspaceId, id))
      await database.delete(user).where(eq(user.id, id))
    })
    const add = (suffix: string) =>
      withNoRssSourceCapacity(id, 1, async (tx) => {
        await tx
          .insert(feeds)
          .values({
            id: `${id}-${suffix}`,
            name: "Page",
            url: `https://example.test/${suffix}`,
            workspaceId: id,
            kind: "page",
          })
      })
    it("allows exactly one competing insert into a capacity-one workspace", async () => {
      const results = await Promise.allSettled([add("a"), add("b")])
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(1)
      expect(
        await database.select().from(feeds).where(eq(feeds.workspaceId, id))
      ).toHaveLength(1)
    })
    it("allows unlimited capacity without a dialect-specific lock", async () => {
      capacity = null
      await expect(add("unlimited")).resolves.toBeUndefined()
    })
  }
)
