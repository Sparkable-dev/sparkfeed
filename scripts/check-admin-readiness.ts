import { and, eq } from "drizzle-orm"
import { user, workspaceSubscriptions } from "@/db/schema"
import { resolveAuthSurfaceConfig } from "@/lib/admin-auth"
import { readDodoBillingConfig } from "@/server/billing/dodo-config"

function roles(value: string): Array<string> {
  return value
    .split(",")
    .map((role) => role.trim())
    .filter(Boolean)
}

async function main() {
  const auth = resolveAuthSurfaceConfig()
  if (!auth.platformAdminEnabled) {
    throw new Error(
      "Admin readiness requires SPARKFEED_EDITION=cloud and SPARKFEED_SURFACE=admin."
    )
  }
  const dodo = readDodoBillingConfig()
  if (!dodo) throw new Error("Dodo test configuration is unavailable.")
  const { db } = await import("@/db/index")

  const [people, subscriptions] = await Promise.all([
    db
      .select({
        role: user.role,
        emailVerified: user.emailVerified,
        twoFactorEnabled: user.twoFactorEnabled,
      })
      .from(user),
    db
      .select({
        workspaceType: workspaceSubscriptions.workspaceType,
        planKey: workspaceSubscriptions.planKey,
        accessState: workspaceSubscriptions.accessState,
      })
      .from(workspaceSubscriptions),
  ])

  const admins = people.filter((person) => roles(person.role).includes("admin"))
  const manualTeams = await db
    .select({ workspaceId: workspaceSubscriptions.workspaceId })
    .from(workspaceSubscriptions)
    .where(
      and(
        eq(workspaceSubscriptions.workspaceType, "organization"),
        eq(workspaceSubscriptions.billingSource, "manual")
      )
    )

  const report = {
    surface: auth.deployment,
    origin: auth.configuredOrigin,
    database: "reachable",
    administrators: {
      count: admins.length,
      verified: admins.filter((person) => person.emailVerified).length,
      totpEnrolled: admins.filter((person) => person.twoFactorEnabled).length,
    },
    billing: {
      environment: dodo.environment,
      personalProductsConfigured:
        Boolean(dodo.personalProducts.monthly) &&
        Boolean(dodo.personalProducts.annual),
    },
    records: {
      users: people.length,
      workspaceSubscriptions: subscriptions.length,
      manualTeamWorkspaces: manualTeams.length,
    },
    bootstrapReady: admins.length === 1 && admins[0].emailVerified,
    adminPortalReady:
      admins.length === 1 &&
      admins[0].emailVerified &&
      admins[0].twoFactorEnabled,
  }

  console.log(JSON.stringify(report, null, 2))
  if (admins.length !== 1 || !admins[0]?.emailVerified) process.exitCode = 1
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Admin readiness check failed."
  )
  process.exitCode = 1
})
