import { randomBytes, scrypt, timingSafeEqual } from "node:crypto"
import { promisify } from "node:util"
import { eq } from "drizzle-orm"
import { db } from "@/db/index"
import { feedShares, folderShares, folders } from "@/db/schema"

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>

const SCHEME = "s1"
const KEYLEN = 32

export type ShareKind = "folder" | "feed"

export interface ResolvedShare {
  /** The row that actually grants access — self, or the nearest shared ancestor. */
  isShared: boolean
  password: string | null
  /** Id of the entity the granting row belongs to. Differs from the requested id when inherited. */
  grantedBy: string
  /**
   * Which table the granting row lives in. Not the same as the requested kind:
   * a feed inherits from a folder, so a feed request can be granted by
   * `folder_shares`.
   */
  grantedKind: ShareKind
  /** Ancestor chain, root first, ending with the requested entity. */
  breadcrumbs: Array<{ id: string; name: string }>
}

/**
 * Walks upward from an entity looking for something that makes it public.
 *
 * Share state is stored per entity but **inherits downward**: a folder with
 * `is_shared = true` exposes everything beneath it, and no rows are written for
 * the descendants. So "is this public" can only be answered by walking parents
 * until a shared one turns up. The nearest shared ancestor wins, and its
 * password is the one enforced.
 *
 * A child cannot opt out. Writing `is_shared = false` on a descendant does not
 * override an ancestor's share — the row simply reads as "no share of its own"
 * and the walk continues past it. That is existing behaviour, preserved here
 * deliberately; changing it needs a real "explicitly private" state.
 *
 * `folders.parent_id` has no foreign key, so a dangling parent silently
 * truncates the walk. Treated as "not shared", which fails closed.
 *
 * Extracted from the share route so `add-to-workspace` can enforce the same
 * rule — it used to copy any folder by raw id with no share check at all.
 */
export async function resolveInheritedShare(
  entityId: string,
  kind: ShareKind,
  seed: { name: string; parentId: string | null },
): Promise<ResolvedShare | null> {
  const breadcrumbs = [{ id: entityId, name: seed.name }]

  const self =
    kind === "feed"
      ? await db
          .select({ isShared: feedShares.isShared, password: feedShares.password })
          .from(feedShares)
          .where(eq(feedShares.feedId, entityId))
          .limit(1)
      : await db
          .select({
            isShared: folderShares.isShared,
            password: folderShares.password,
          })
          .from(folderShares)
          .where(eq(folderShares.folderId, entityId))
          .limit(1)

  if (self.length > 0 && !!self[0].isShared) {
    return {
      isShared: true,
      password: self[0].password ?? null,
      grantedBy: entityId,
      grantedKind: kind,
      breadcrumbs,
    }
  }

  let currentParentId = seed.parentId
  const guard = new Set<string>([entityId])

  while (currentParentId) {
    // parent_id has no FK and nothing prevents a cycle; bail rather than hang.
    if (guard.has(currentParentId)) break
    guard.add(currentParentId)

    const parentResult = await db
      .select({ id: folders.id, name: folders.name, parentId: folders.parentId })
      .from(folders)
      .where(eq(folders.id, currentParentId))
      .limit(1)

    if (parentResult.length === 0) break

    const parent = parentResult[0]
    breadcrumbs.unshift({ id: parent.id, name: parent.name })

    const parentShare = await db
      .select()
      .from(folderShares)
      .where(eq(folderShares.folderId, parent.id))
      .limit(1)

    if (parentShare.length > 0 && !!parentShare[0].isShared) {
      return {
        isShared: true,
        password: parentShare[0].password ?? null,
        grantedBy: parent.id,
        // Always a folder — the walk only ever climbs through folders.
        grantedKind: "folder",
        breadcrumbs,
      }
    }

    currentParentId = parent.parentId
  }

  return null
}

// ─────────────────────────────────────────────
// SHARE PASSWORDS
// ─────────────────────────────────────────────

/**
 * Share passwords are hashed at rest.
 *
 * They used to be stored as plaintext and compared with `!==`, which meant the
 * privacy policy had to describe a share password as an access gate rather than
 * a secret. Stored as `s1$<salt>$<key>`; anything without that prefix is a
 * legacy plaintext row, compared directly and re-hashed on the next write.
 */
export async function hashSharePassword(plain: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scryptAsync(plain, salt, KEYLEN)
  return `${SCHEME}$${salt.toString("hex")}$${key.toString("hex")}`
}

export function isLegacyPlaintext(stored: string): boolean {
  return !stored.startsWith(`${SCHEME}$`)
}

export async function verifySharePassword(
  plain: string,
  stored: string,
): Promise<boolean> {
  if (isLegacyPlaintext(stored)) {
    // Rows written before hashing landed. timingSafeEqual throws outright on a
    // length mismatch, so hash both sides with a fixed salt first: equal-width
    // digests, no early return, and the comparison stays constant time.
    const salt = Buffer.alloc(16)
    const [a, b] = await Promise.all([
      scryptAsync(plain, salt, KEYLEN),
      scryptAsync(stored, salt, KEYLEN),
    ])
    return timingSafeEqual(a, b)
  }

  const [, saltHex, keyHex] = stored.split("$")
  if (!saltHex || !keyHex) return false

  const key = await scryptAsync(plain, Buffer.from(saltHex, "hex"), KEYLEN)
  const expected = Buffer.from(keyHex, "hex")
  if (key.length !== expected.length) return false
  return timingSafeEqual(key, expected)
}

/**
 * Replaces a verified plaintext password with a hash, in place.
 *
 * Without this, legacy rows stay plaintext until someone happens to re-set the
 * password — which for a share created once and never touched again is never.
 * Called after a successful verification, so the plaintext is known correct and
 * nothing can be locked out by the rewrite. Best effort: a failure here must not
 * fail the read that triggered it.
 */
export async function upgradeLegacySharePassword(
  share: ResolvedShare,
  verifiedPlain: string,
): Promise<void> {
  if (!share.password || !isLegacyPlaintext(share.password)) return

  try {
    const hashed = await hashSharePassword(verifiedPlain)
    if (share.grantedKind === "feed") {
      await db
        .update(feedShares)
        .set({ password: hashed })
        .where(eq(feedShares.feedId, share.grantedBy))
    } else {
      await db
        .update(folderShares)
        .set({ password: hashed })
        .where(eq(folderShares.folderId, share.grantedBy))
    }
  } catch (err) {
    console.error("Share password upgrade failed:", err)
  }
}
