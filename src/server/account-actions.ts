import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { db } from "@/db/index"
import {
  hasManagedPersonalPlusSubscription,
  ownedWorkspacesForUser,
} from "@/server/account-deletion"
import {
  readAccountNotificationPreferences,
  saveAccountNotificationPreferences,
} from "@/server/account-notifications"

async function accountSession() {
  const { auth } = await import("@/lib/auth")
  const { getRequestHeaders } = await import("@tanstack/react-start/server")
  const session = await auth.api.getSession({ headers: getRequestHeaders() })
  if (!session) throw new Error("Sign in to manage your account.")
  return session
}

export const getAccountDeletionState = createServerFn({
  method: "GET",
}).handler(async () => {
  const session = await accountSession()

  const [ownedWorkspaces, personalPlusActive] = await Promise.all([
    ownedWorkspacesForUser(db, session.user.id),
    hasManagedPersonalPlusSubscription(db, session.user.id),
  ])

  return { ownedWorkspaces, personalPlusActive }
})

export const getAccountNotificationPreferences = createServerFn({
  method: "GET",
}).handler(async () => {
  const session = await accountSession()
  return readAccountNotificationPreferences(db, session.user.id)
})

export const updateAccountNotificationPreferences = createServerFn({
  method: "POST",
})
  .validator(
    z.object({
      workspaceActivity: z.boolean(),
      productUpdates: z.boolean(),
    })
  )
  .handler(async ({ data }) => {
    const session = await accountSession()
    return saveAccountNotificationPreferences(db, session.user.id, data)
  })
