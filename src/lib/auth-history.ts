import type { BetterAuthPlugin } from "better-auth"

export interface CustomerAuthEvent {
  userId: string
  sessionId?: string
  action: "sign_in" | "account_linked" | "account_unlinked"
  method: string
}

const providers = new Set(["credential", "google", "github"])

async function persistEvent(event: CustomerAuthEvent) {
  const [{ db }, { customerAuthEvents }] = await Promise.all([
    import("@/db/index"),
    import("@/db/schema"),
  ])
  await db.insert(customerAuthEvents).values({
    ...event,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  })
}

/** Capture successful writes, rather than inferring a login from linked accounts. */
export function customerAuthenticationHistory(
  record: (event: CustomerAuthEvent) => Promise<void> = persistEvent
): BetterAuthPlugin {
  async function save(event: CustomerAuthEvent) {
    try {
      await record(event)
    } catch {
      // Telemetry failure must not lock customers out. Never log the auth context.
      console.warn("Unable to record customer authentication history.")
    }
  }
  return {
    id: "customer-authentication-history",
    init() {
      return {
        options: {
          databaseHooks: {
            session: {
              create: {
                after: async (session, ctx) => {
                  const path = ctx?.path
                  let method: string | undefined
                  if (path === "/sign-in/email" || path === "/sign-up/email")
                    method = "credential"
                  else if (path === "/verify-email")
                    method = "email-verification"
                  else if (path === "/sign-in/social")
                    method = ctx?.body?.provider
                  else if (path?.startsWith("/callback/"))
                    method = ctx?.params?.id || path.split("/").at(-1)
                  if (
                    !method ||
                    (!providers.has(method) && method !== "email-verification")
                  )
                    return
                  await save({
                    userId: session.userId,
                    sessionId: session.id,
                    action: "sign_in",
                    method,
                  })
                },
              },
            },
            account: {
              create: {
                after: async (account) => {
                  if (providers.has(account.providerId))
                    await save({
                      userId: account.userId,
                      action: "account_linked",
                      method: account.providerId,
                    })
                },
              },
              delete: {
                after: async (account, ctx) => {
                  if (
                    ctx?.path === "/unlink-account" &&
                    providers.has(account.providerId)
                  )
                    await save({
                      userId: account.userId,
                      action: "account_unlinked",
                      method: account.providerId,
                    })
                },
              },
            },
          },
        },
      }
    },
  }
}
