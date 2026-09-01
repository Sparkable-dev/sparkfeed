import { eq } from "drizzle-orm"
import type { Database } from "@/db/client"
import { notificationPreferences } from "@/db/schema"

export interface AccountNotificationPreferences {
  workspaceActivity: boolean
  productUpdates: boolean
}

export const DEFAULT_ACCOUNT_NOTIFICATION_PREFERENCES: AccountNotificationPreferences =
  {
    workspaceActivity: true,
    productUpdates: false,
  }

export async function readAccountNotificationPreferences(
  database: Database,
  userId: string
): Promise<AccountNotificationPreferences> {
  const [preferences] = await database
    .select({
      workspaceActivity: notificationPreferences.workspaceActivity,
      productUpdates: notificationPreferences.productUpdates,
    })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1)

  return preferences
    ? {
        workspaceActivity: Boolean(preferences.workspaceActivity),
        productUpdates: Boolean(preferences.productUpdates),
      }
    : DEFAULT_ACCOUNT_NOTIFICATION_PREFERENCES
}

export async function saveAccountNotificationPreferences(
  database: Database,
  userId: string,
  preferences: AccountNotificationPreferences
): Promise<AccountNotificationPreferences> {
  await database
    .insert(notificationPreferences)
    .values({ userId, ...preferences, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: notificationPreferences.userId,
      set: { ...preferences, updatedAt: new Date() },
    })

  return preferences
}
