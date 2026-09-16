import { hashPassword } from "better-auth/crypto"
import { createDb } from "../src/db/client"
import {
  account,
  member,
  organization,
  teamBillingState,
  user,
  workspaceSubscriptions,
} from "../src/db/schema"

const url = new URL(process.env.DATABASE_URL ?? "")
if (
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  !url.pathname.endsWith("_qa")
)
  throw new Error("Only run against a disposable local *_qa database.")
const db = createDb(url.toString())
const owner = "team-billing-ui-qa"
await db
  .insert(user)
  .values({
    id: owner,
    name: "Team Billing QA",
    email: "team-billing-qa@example.test",
    emailVerified: true,
  })
  .onConflictDoNothing()
await db
  .insert(account)
  .values({
    id: owner,
    userId: owner,
    accountId: owner,
    issuer: "local:credential",
    providerId: "credential",
    password: await hashPassword("Local-Team-QA-2026!"),
  })
  .onConflictDoUpdate({
    target: account.id,
    set: { issuer: "local:credential" },
  })
for (const pending of [true, false]) {
  const id = pending ? "qa-pending-team" : "qa-active-team"
  await db.transaction(async (tx) => {
    await tx
      .insert(organization)
      .values({
        id,
        name: pending ? "Pending Team QA" : "Active Team QA",
        slug: id,
      })
      .onConflictDoNothing()
    await tx
      .insert(workspaceSubscriptions)
      .values({
        workspaceType: "organization",
        workspaceId: id,
        planKey: "pro",
        billingSource: "dodo",
        subscriptionStatus: pending ? "checkout_pending" : "active",
        accessState: pending ? "read_only" : "active",
        billingInterval: "monthly",
        paidSeatQuantity: pending ? 1 : 3,
        currentPeriodStart: pending ? null : new Date().toISOString(),
        currentPeriodEnd: pending
          ? null
          : new Date(Date.now() + 30 * 86400000).toISOString(),
      })
      .onConflictDoNothing()
    await tx
      .insert(member)
      .values({
        id: `${id}-owner`,
        organizationId: id,
        userId: owner,
        role: "owner",
      })
      .onConflictDoNothing()
    await tx
      .insert(teamBillingState)
      .values({
        workspaceId: id,
        attemptId: `${id}-attempt`,
        interval: "monthly",
        seats: 3,
      })
      .onConflictDoNothing()
  })
}
await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end()
console.log(
  "Local Team billing QA fixtures ready. No provider calls were made."
)
