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
  return db.transaction(async (tx) => {
    const query = tx
      .select({
        id: user.id,
        email: user.email,
        name: user.name,
        dodoCustomerId: user.dodoCustomerId,
      })
      .from(user)
      .where(eq(user.id, userId))
    if (typeof query.for === "function") query.for("update")
    const [account] = await query.limit(1)

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
      { maxRetries: 0 }
    )

    await tx
      .update(user)
      .set({ dodoCustomerId: customer.customer_id })
      .where(eq(user.id, userId))

    return customer.customer_id
  })
}
