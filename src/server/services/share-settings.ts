import { eq } from "drizzle-orm"
import { resolveWorkspaceContextFromHeaders } from "./context"
import { assertOwnsFeed, assertOwnsFolder } from "./ownership"
import {  hashSharePassword } from "./shares"
import type {ShareKind} from "./shares";
import { DEMO_MODE } from "@/lib/demo"
import { feedShares, folderShares } from "@/db/schema"
import { db } from "@/db/index"

export type ShareSettingsResult =
  | { ok: true; isShared: boolean; hasPassword: boolean }
  | { ok: false; status: number; error: string }

const UNAUTHORIZED = { ok: false as const, status: 401, error: "Unauthorized" }
const NOT_FOUND = { ok: false as const, status: 404, error: "Not found" }
const DEMO_LOCKED = {
  ok: false as const,
  status: 403,
  error: "This feature is locked in demo mode",
}

/**
 * Ownership check shared by both share routes.
 *
 * These routes shipped checking only that *someone* was signed in, so any
 * authenticated user could read or change the share state of any folder or feed
 * in the database by posting its id. The 404 on a foreign id is deliberate and
 * matches `ownership.ts`: distinguishing "missing" from "not yours" leaks which
 * ids exist.
 */
async function authorize(
  kind: ShareKind,
  entityId: string,
  headers: Headers,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const caller = await resolveWorkspaceContextFromHeaders(headers)
  if (!caller.userId && !caller.demo) return UNAUTHORIZED

  try {
    if (kind === "feed") await assertOwnsFeed(entityId, caller.workspaceId)
    else await assertOwnsFolder(entityId, caller.workspaceId)
  } catch {
    return NOT_FOUND
  }
  return { ok: true }
}

export async function readShareSettings(
  kind: ShareKind,
  entityId: string,
  headers: Headers,
): Promise<ShareSettingsResult> {
  const auth = await authorize(kind, entityId, headers)
  if (!auth.ok) return auth

  const rows =
    kind === "feed"
      ? await db
          .select()
          .from(feedShares)
          .where(eq(feedShares.feedId, entityId))
          .limit(1)
      : await db
          .select()
          .from(folderShares)
          .where(eq(folderShares.folderId, entityId))
          .limit(1)

  return {
    ok: true,
    isShared: rows.length > 0 ? !!rows[0].isShared : false,
    hasPassword: rows.length > 0 && !!rows[0].password,
  }
}

export interface ShareWrite {
  isShared: boolean
  /**
   * Tri-state on purpose.
   *
   * `undefined` — field absent from the request, leave any existing password
   * alone. The previous implementation wrote `password || null`, so a toggle
   * request that simply did not mention the password silently wiped it.
   * `null` or `""` — clear it. A string — set it.
   */
  password?: string | null
}

export async function writeShareSettings(
  kind: ShareKind,
  entityId: string,
  write: ShareWrite,
  headers: Headers,
): Promise<ShareSettingsResult> {
  if (DEMO_MODE) return DEMO_LOCKED

  const auth = await authorize(kind, entityId, headers)
  if (!auth.ok) return auth

  // Hashed at rest. Turning sharing off clears the password outright rather
  // than keeping a hash for a link that no longer resolves.
  let passwordValue: string | null | undefined
  if (!write.isShared) {
    passwordValue = null
  } else if (write.password === undefined) {
    passwordValue = undefined
  } else if (write.password === null || write.password === "") {
    passwordValue = null
  } else {
    passwordValue = await hashSharePassword(write.password)
  }

  if (kind === "feed") {
    const existing = await db
      .select({ feedId: feedShares.feedId })
      .from(feedShares)
      .where(eq(feedShares.feedId, entityId))
      .limit(1)

    if (existing.length > 0) {
      await db
        .update(feedShares)
        .set({
          isShared: write.isShared,
          ...(passwordValue !== undefined ? { password: passwordValue } : {}),
        })
        .where(eq(feedShares.feedId, entityId))
    } else {
      await db.insert(feedShares).values({
        feedId: entityId,
        isShared: write.isShared,
        password: passwordValue ?? null,
      })
    }
  } else {
    const existing = await db
      .select({ folderId: folderShares.folderId })
      .from(folderShares)
      .where(eq(folderShares.folderId, entityId))
      .limit(1)

    if (existing.length > 0) {
      await db
        .update(folderShares)
        .set({
          isShared: write.isShared,
          ...(passwordValue !== undefined ? { password: passwordValue } : {}),
        })
        .where(eq(folderShares.folderId, entityId))
    } else {
      await db.insert(folderShares).values({
        folderId: entityId,
        isShared: write.isShared,
        password: passwordValue ?? null,
      })
    }
  }

  return await readShareSettings(kind, entityId, headers)
}
