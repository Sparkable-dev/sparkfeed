import { readSparkfeedDeploymentConfig } from "@/server/entitlements/config"

export class PlatformAdminHttpError extends Error {
  constructor(
    public readonly status: 401 | 403 | 404 | 429,
    message: string
  ) {
    super(message)
    this.name = "PlatformAdminHttpError"
  }
}

export function platformAdminIsExposed(
  env: Record<string, string | undefined> = process.env
): boolean {
  try {
    const config = readSparkfeedDeploymentConfig(env)
    return config.edition === "cloud" && config.surface === "admin"
  } catch {
    return false
  }
}

export function assertPlatformAdminSurface(
  env: Record<string, string | undefined> = process.env
): void {
  if (!platformAdminIsExposed(env)) {
    throw new PlatformAdminHttpError(404, "Not found")
  }
}

function roles(value: unknown): Array<string> {
  if (typeof value !== "string") return []
  return value
    .split(",")
    .map((role) => role.trim())
    .filter(Boolean)
}

export async function bootstrapPlatformAdminIfEligible(account: {
  id: string
  email: string
  emailVerified: boolean
  role?: string | null
}): Promise<boolean> {
  const bootstrapEmail =
    process.env.SPARKFEED_ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase()
  if (
    !bootstrapEmail ||
    !account.emailVerified ||
    account.email.trim().toLowerCase() !== bootstrapEmail ||
    roles(account.role).includes("admin")
  ) {
    return false
  }

  const [{ db }, { user }, { eq }] = await Promise.all([
    import("@/db/index"),
    import("@/db/schema"),
    import("drizzle-orm"),
  ])
  return db.transaction(async (tx) => {
    const people = await tx.select({ role: user.role }).from(user)
    if (people.some((person) => roles(person.role).includes("admin"))) {
      return false
    }
    const promoted = await tx
      .update(user)
      .set({ role: "admin", updatedAt: new Date() })
      .where(eq(user.id, account.id))
      .returning({ id: user.id })
    return promoted.length === 1
  })
}

export interface PlatformAdminActor {
  userId: string
  email: string
}

export type PlatformAdminSessionState =
  | { state: "unauthenticated" }
  | { state: "forbidden" }
  | { state: "totp_required" }
  | { state: "authorized"; actor: PlatformAdminActor }

export async function readPlatformAdminSessionState(
  request: Request
): Promise<PlatformAdminSessionState> {
  assertPlatformAdminSurface()
  const { auth } = await import("@/lib/auth")
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) return { state: "unauthenticated" }

  const adminUser = session.user as typeof session.user & {
    role?: string | null
    twoFactorEnabled?: boolean | null
  }
  let isAdmin = roles(adminUser.role).includes("admin")
  if (!isAdmin) {
    isAdmin = await bootstrapPlatformAdminIfEligible({
      id: adminUser.id,
      email: adminUser.email,
      emailVerified: adminUser.emailVerified,
      role: adminUser.role,
    })
  }
  if (!isAdmin) return { state: "forbidden" }
  if (adminUser.twoFactorEnabled !== true) return { state: "totp_required" }
  return {
    state: "authorized",
    actor: { userId: adminUser.id, email: adminUser.email },
  }
}

export async function requirePlatformAdmin(
  request: Request
): Promise<PlatformAdminActor> {
  const state = await readPlatformAdminSessionState(request)
  if (state.state === "unauthenticated") {
    throw new PlatformAdminHttpError(401, "Sign in to the admin service.")
  }
  if (state.state === "forbidden") {
    throw new PlatformAdminHttpError(
      403,
      "Platform administrator access is required."
    )
  }
  if (state.state === "totp_required") {
    throw new PlatformAdminHttpError(403, "TOTP enrollment is required.")
  }
  return state.actor
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin")
  if (!origin || origin !== new URL(request.url).origin) {
    throw new PlatformAdminHttpError(
      403,
      "Cross-origin admin mutation rejected."
    )
  }
}

const attempts = new Map<string, Array<number>>()
const ADMIN_WINDOW_MS = 60_000
const ADMIN_MAX_MUTATIONS = 30

export function enforceAdminMutationRateLimit(
  actorUserId: string,
  now = Date.now()
): void {
  // There is one launch administrator. Actor-level throttling is stricter than
  // trusting a deployment-specific forwarded-IP header.
  const key = actorUserId
  const recent = (attempts.get(key) || []).filter(
    (timestamp) => now - timestamp < ADMIN_WINDOW_MS
  )
  if (recent.length >= ADMIN_MAX_MUTATIONS) {
    attempts.set(key, recent)
    throw new PlatformAdminHttpError(
      429,
      "Too many admin mutations. Try again shortly."
    )
  }
  recent.push(now)
  attempts.set(key, recent)
}

export function resetAdminMutationRateLimitsForTests(): void {
  attempts.clear()
}
