import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { eq } from "drizzle-orm"
import { customerAuthenticationHistory } from "../auth-history"
import type { Database } from "@/db/client"
import { createDb } from "@/db/client"
import * as schema from "@/db/schema"

let database: Database
vi.mock("@/db/index", () => ({
  get db() {
    return database
  },
}))

describe.runIf(process.env.RUN_PLATFORM_POSTGRES_TESTS === "true")(
  "persisted authentication history",
  () => {
    const email = `auth-history-${randomUUID()}@example.test`
    let userId: string
    beforeAll(() => {
      const url = process.env.DATABASE_URL
      if (!url || !new URL(url).pathname.endsWith("_qa"))
        throw new Error("Use a disposable *_qa database")
      database = createDb(url)
    })
    afterAll(async () => {
      if (userId)
        await database.delete(schema.user).where(eq(schema.user.id, userId))
    })
    it("persists successful credential sessions, excludes failed attempts, and cascades customer deletion", async () => {
      const auth = betterAuth({
        baseURL: "http://localhost:3000",
        secret: "test-only-authentication-history-secret",
        database: drizzleAdapter(database, { provider: "pg", schema }),
        emailAndPassword: { enabled: true },
        plugins: [customerAuthenticationHistory()],
      })
      const signup = await auth.api.signUpEmail({
        body: { name: "History QA", email, password: "test-only-password" },
      })
      userId = signup.user.id
      const signin = await auth.api.signInEmail({
        body: { email, password: "test-only-password" },
      })
      expect(signin.user.id).toBe(userId)
      const history = await database
        .select()
        .from(schema.customerAuthEvents)
        .where(eq(schema.customerAuthEvents.userId, userId))
      expect(
        history.filter((event) => event.action === "sign_in")
      ).toHaveLength(2)
      expect(
        history.filter((event) => event.action === "account_linked")
      ).toHaveLength(1)
      expect(history.every((event) => event.method === "credential")).toBe(true)
      const sessions = await database
        .select()
        .from(schema.session)
        .where(eq(schema.session.userId, userId))
      expect(
        history
          .filter((event) => event.sessionId)
          .map((event) => event.sessionId)
          .sort()
      ).toEqual(sessions.map((s) => s.id).sort())
      await expect(
        auth.api.signInEmail({
          body: { email, password: "incorrect-password" },
        })
      ).rejects.toThrow()
      expect(
        await database
          .select()
          .from(schema.customerAuthEvents)
          .where(eq(schema.customerAuthEvents.userId, userId))
      ).toHaveLength(3)
      await database.delete(schema.user).where(eq(schema.user.id, userId))
      expect(
        await database
          .select()
          .from(schema.customerAuthEvents)
          .where(eq(schema.customerAuthEvents.userId, userId))
      ).toHaveLength(0)
    })
  }
)
