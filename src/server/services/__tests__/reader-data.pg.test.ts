import { readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { eq, inArray, sql } from "drizzle-orm"
import type { Database } from "@/db/client"
import type { WorkspaceContext } from "../context"
import { createDb } from "@/db/client"
import {
  articles,
  feeds,
  folders,
  personalFavorites,
  user,
  workspaceSubscriptions,
} from "@/db/schema"

let database: Database
let context: WorkspaceContext
const writable = vi.hoisted(() => vi.fn())
vi.mock("@/db/index", () => ({
  get db() {
    return database
  },
}))
vi.mock("../context", () => ({
  resolveWorkspaceContext: () => Promise.resolve(context),
}))
vi.mock("@/server/entitlements/browser-write", () => ({
  workspaceWriteMiddleware: writable,
}))
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validator: any
    let middleware: Array<() => Promise<void>> = []
    const builder = {
      validator: (next: any) => {
        validator = next
        return builder
      },
      middleware: (next: typeof middleware) => {
        middleware = next
        return builder
      },
      handler: (handler: any) => async (input: any) => {
        for (const run of middleware) await run()
        return handler({ data: validator.parse(input.data) })
      },
    }
    return builder
  },
}))
const { getArticlePage, setFavorites } = await import("@/server/reader-data")
const { readFavoriteIds } = await import("../favorites")
const { readNavigationCounts } = await import("../navigation")
const { initializeWorkspace } = await import("../initialize-workspace")
const prefix = `reader-${randomUUID()}`
const alice = `${prefix}-alice`,
  bob = `${prefix}-bob`,
  team = `${prefix}-team`
const personalFeed = `${prefix}-personal`,
  teamFeed = `${prefix}-shared`
const oldId = `${prefix}-old`,
  teamId = `${prefix}-team-article`
const ctx = (person = alice, workspaceId = alice): WorkspaceContext => ({
  userId: person,
  workspaceId,
  workspace: {
    id: workspaceId,
    type: workspaceId === person ? "personal" : "organization",
  },
  emailVerified: true,
  demo: false,
})
const save = (
  ids: Array<string>,
  state = true,
  scope: "personal" | "workspace" = "personal"
) =>
  setFavorites({
    data: {
      userId: context.userId!,
      workspaceId: context.workspaceId!,
      ids,
      scope,
      state,
    },
  })

describe.runIf(process.env.RUN_READER_POSTGRES_TESTS === "true")(
  "reader and favorites on PostgreSQL",
  () => {
    beforeAll(async () => {
      const url = process.env.DATABASE_URL
      if (!url || !new URL(url).pathname.endsWith("_qa"))
        throw new Error("Use a disposable *_qa database")
      database = createDb(url)
      vi.stubEnv("SPARKFEED_EDITION", "cloud")
      writable.mockResolvedValue(undefined)
      await database.insert(user).values([
        { id: alice, name: "Alice", email: alice + "@example.test" },
        { id: bob, name: "Bob", email: bob + "@example.test" },
      ])
      await database.insert(feeds).values([
        {
          id: personalFeed,
          workspaceId: alice,
          name: "Personal",
          url: "https://example.test/rss",
        },
        {
          id: teamFeed,
          workspaceId: team,
          name: "Team",
          url: "https://example.test/team",
        },
      ])
      await database.insert(workspaceSubscriptions).values({
        workspaceType: "organization",
        workspaceId: team,
        planKey: "pro",
        billingSource: "manual",
        subscriptionStatus: "active",
        accessState: "active",
      })
      await database.insert(articles).values([
        {
          id: oldId,
          feedId: personalFeed,
          title: "Archived favorite",
          link: "https://example.test/old",
          publishedAt: "2020-01-01T00:00:00Z",
          isFavorite: true,
        },
        {
          id: teamId,
          feedId: teamFeed,
          title: "Shared article",
          link: "https://example.test/team-story",
          publishedAt: "2020-01-01T00:00:00Z",
          isFavorite: true,
        },
        ...Array.from({ length: 245 }, (_, i) => ({
          id: `${prefix}-${String(i).padStart(3, "0")}`,
          feedId: personalFeed,
          title: `Recent ${i}`,
          link: `https://example.test/${i}`,
          publishedAt: new Date().toISOString(),
        })),
      ])
    })
    afterAll(async () => {
      if (!database) return
      await database
        .delete(articles)
        .where(inArray(articles.feedId, [personalFeed, teamFeed]))
      await database
        .delete(feeds)
        .where(inArray(feeds.id, [personalFeed, teamFeed]))
      await database
        .delete(folders)
        .where(inArray(folders.workspaceId, [alice, bob]))
      await database
        .delete(workspaceSubscriptions)
        .where(eq(workspaceSubscriptions.workspaceId, team))
      await database.delete(user).where(inArray(user.id, [alice, bob]))
      await (database as any).$client.end()
      vi.unstubAllEnvs()
    })
    it("backfills legacy personal saves idempotently without copying team saves to people", async () => {
      const migration = readFileSync(
        "drizzle/0020_personal_favorites.sql",
        "utf8"
      )
        .split("--> statement-breakpoint")
        .at(-1)!
      await database.execute(sql.raw(migration))
      await database.execute(sql.raw(migration))
      const saved = await database
        .select()
        .from(personalFavorites)
        .where(eq(personalFavorites.userId, alice))
      expect(saved.map((row) => row.articleId)).toEqual([oldId])
      context = ctx(alice, team)
      expect((await readFavoriteIds(context)).workspace).toContain(teamId)
      expect((await readFavoriteIds(context)).personal).not.toContain(teamId)
    })
    it("keeps a favorite from 2020 visible beyond 245 newer articles", async () => {
      context = ctx()
      const result = await getArticlePage({
        data: {
          userId: alice,
          workspaceId: alice,
          favorites: "personal",
          days: 15,
        },
      })
      expect(result.items.map((row) => row.id)).toEqual([oldId])
    })
    it("paginates the whole collection without missing or repeating IDs", async () => {
      context = ctx()
      const ids: Array<string> = []
      let cursor: string | undefined
      do {
        const page = await getArticlePage({
          data: { userId: alice, workspaceId: alice, days: 0, cursor },
        })
        ids.push(...page.items.map((row) => row.id))
        cursor = page.nextCursor ?? undefined
      } while (cursor)
      expect(ids).toHaveLength(246)
      expect(new Set(ids).size).toBe(246)
      expect(ids).toContain(oldId)
      expect((await readNavigationCounts(alice)).total).toBe(246)
    })
    it("isolates personal favorites between two members of the same team", async () => {
      context = ctx(alice, team)
      await save([teamId])
      expect((await readFavoriteIds(context)).personal).toContain(teamId)
      context = ctx(bob, team)
      expect((await readFavoriteIds(context)).personal).not.toContain(teamId)
      await save([teamId], false)
      context = ctx(alice, team)
      expect((await readFavoriteIds(context)).personal).toContain(teamId)
    })
    it("removes a personal save even if the old workspace flag remains true", async () => {
      context = ctx()
      await save([oldId], false)
      expect((await readFavoriteIds(context)).personal).not.toContain(oldId)
      await save([oldId])
      await save([oldId])
      expect(
        (await readFavoriteIds(context)).personal.filter((id) => id === oldId)
      ).toHaveLength(1)
    })
    it("shares workspace saves but locks them in personal Free/Personal+ workspaces", async () => {
      context = ctx()
      await expect(save([oldId], true, "workspace")).rejects.toThrow(
        "team workspace"
      )
      context = ctx(alice, team)
      await save([teamId], false, "workspace")
      context = ctx(bob, team)
      expect((await readFavoriteIds(context)).workspace).not.toContain(teamId)
      await save([teamId], true, "workspace")
      context = ctx(alice, team)
      expect((await readFavoriteIds(context)).workspace).toContain(teamId)
    })
    it("enforces the Cloud plan matrix without deleting saved workspace favorites", async () => {
      context = ctx(alice, team)
      for (const planKey of [
        "free",
        "personal_plus",
        "pro",
        "enterprise",
      ] as const) {
        await database
          .update(workspaceSubscriptions)
          .set({ planKey })
          .where(eq(workspaceSubscriptions.workspaceId, team))
        const enabled = planKey === "pro" || planKey === "enterprise"
        const favorites = await readFavoriteIds(context)
        expect(favorites.workspaceEnabled).toBe(enabled)
        expect(favorites.workspace).toContain(teamId)
        if (enabled)
          await expect(save([teamId], true, "workspace")).resolves.toEqual({
            ids: [teamId],
          })
        else
          await expect(save([teamId], true, "workspace")).rejects.toThrow(
            "team workspace"
          )
      }
      await database
        .update(workspaceSubscriptions)
        .set({ planKey: "pro" })
        .where(eq(workspaceSubscriptions.workspaceId, team))
    })
    it("rejects changed identities, foreign article IDs, and invalid cursors", async () => {
      context = ctx()
      expect((await save([teamId])).ids).toEqual([])
      await expect(
        getArticlePage({ data: { userId: bob, workspaceId: alice } })
      ).rejects.toThrow("Workspace changed")
      await expect(
        getArticlePage({ data: { userId: alice, workspaceId: team } })
      ).rejects.toThrow("Workspace changed")
      await expect(
        getArticlePage({
          data: { userId: alice, workspaceId: alice, cursor: "bad" },
        })
      ).rejects.toThrow("Malformed cursor")
    })
    it("searches archived items and treats wildcard characters literally", async () => {
      context = ctx()
      expect(
        (
          await getArticlePage({
            data: {
              userId: alice,
              workspaceId: alice,
              days: 0,
              query: "Archived favorite",
            },
          })
        ).items.map((row) => row.id)
      ).toEqual([oldId])
      expect(
        (
          await getArticlePage({
            data: { userId: alice, workspaceId: alice, days: 0, query: "%" },
          })
        ).items
      ).toEqual([])
    })
    it("creates one initial folder under concurrent setup calls", async () => {
      await Promise.all([initializeWorkspace(bob), initializeWorkspace(bob)])
      expect(
        await database
          .select()
          .from(folders)
          .where(eq(folders.workspaceId, bob))
      ).toHaveLength(1)
    })
    it("supports 180-day history and uses first-added time for unknown publication dates", async () => {
      context = ctx()
      const now = Date.now()
      const rows = [
        {
          id: `${prefix}-history-inside`,
          publishedAt: new Date(now - 179 * 86_400_000).toISOString(),
          createdAt: new Date(now).toISOString(),
        },
        {
          id: `${prefix}-history-outside`,
          publishedAt: new Date(now - 181 * 86_400_000).toISOString(),
          createdAt: new Date(now).toISOString(),
        },
        {
          id: `${prefix}-history-undated`,
          publishedAt: null,
          createdAt: new Date(now - 100 * 86_400_000).toISOString(),
        },
      ]
      await database
        .insert(articles)
        .values(
          rows.map((row) => ({
            ...row,
            feedId: personalFeed,
            title: "History boundary",
            link: `https://example.test/${row.id}`,
          }))
        )
      try {
        const page = await getArticlePage({
          data: {
            userId: alice,
            workspaceId: alice,
            days: 180,
            query: "History boundary",
          },
        })
        expect(page.items.map((row) => row.id).sort()).toEqual(
          [rows[0].id, rows[2].id].sort()
        )
        const short = await getArticlePage({
          data: {
            userId: alice,
            workspaceId: alice,
            days: 90,
            query: "History boundary",
          },
        })
        expect(short.items).toHaveLength(0)
        const all = await getArticlePage({
          data: {
            userId: alice,
            workspaceId: alice,
            days: 0,
            query: "History boundary",
          },
        })
        expect(all.items).toHaveLength(3)
      } finally {
        await database.delete(articles).where(
          inArray(
            articles.id,
            rows.map((row) => row.id)
          )
        )
      }
    })
    it("enforces the write guard before saving", async () => {
      context = ctx()
      writable.mockRejectedValueOnce(new Error("read-only"))
      await expect(save([oldId])).rejects.toThrow("read-only")
    })
  }
)
