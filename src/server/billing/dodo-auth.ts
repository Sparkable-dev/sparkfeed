import { and, eq } from "drizzle-orm"
import { dodopayments, portal } from "@dodopayments/better-auth"
import { createDodoClient } from "./dodo-client"
import { readDodoBillingConfig } from "./dodo-config"
import { db } from "@/db/index"
import { user, workspaceSubscriptions } from "@/db/schema"
import { readSparkfeedDeploymentConfig } from "@/server/entitlements/config"

export function dodoBetterAuthPlugin() {
  if (readSparkfeedDeploymentConfig().surface !== "app") return null
  const config = readDodoBillingConfig()
  if (!config) return null

  return dodopayments({
    client: createDodoClient(config),
    createCustomerOnSignUp: false,
    use: [portal()],
    getCustomerParams: (account) => ({
      metadata: {
        billingSubjectType: "personal",
        billingSubjectId: account.id,
        environment: config.environment,
      },
    }),
  })
}

export async function assertPersonalPortalAllowed(
  userId: string
): Promise<void> {
  const [record] = await db
    .select({
      customerId: user.dodoCustomerId,
      subscriptionId: workspaceSubscriptions.dodoSubscriptionId,
    })
    .from(user)
    .leftJoin(
      workspaceSubscriptions,
      and(
        eq(workspaceSubscriptions.workspaceType, "personal"),
        eq(workspaceSubscriptions.workspaceId, user.id)
      )
    )
    .where(eq(user.id, userId))
    .limit(1)

  if (!record?.customerId || !record.subscriptionId) {
    throw new Error(
      "The billing portal is available after a Personal+ subscription is created."
    )
  }
}
