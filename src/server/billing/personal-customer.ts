import { eq } from "drizzle-orm"
import type DodoPayments from "dodopayments"
import type { DodoEnvironment } from "./dodo-config"
import { db } from "@/db/index"
import { user } from "@/db/schema"

export async function ensurePersonalDodoCustomer(
  userId: string,
  client: DodoPayments,
  environment: DodoEnvironment
): Promise<string> {
  const [account] = await db
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
      dodoCustomerId: user.dodoCustomerId,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)

  if (!account) throw new Error("Account not found.")
  if (account.dodoCustomerId) return account.dodoCustomerId

  const customer = await client.customers.create(
    {
      email: account.email,
      name: account.name,
      metadata: {
        billingSubjectType: "personal",
        billingSubjectId: userId,
        environment,
      },
    },
    { idempotencyKey: `personal:${userId}` }
  )

  await db
    .update(user)
    .set({ dodoCustomerId: customer.customer_id })
    .where(eq(user.id, userId))

  return customer.customer_id
}
