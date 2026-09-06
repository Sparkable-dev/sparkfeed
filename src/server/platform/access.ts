import { PlatformRequestError } from "./assertion"

/** Created only after verification of a signed private-dashboard assertion. */
export interface PlatformActor {
  userId: string
  email: string
}

const attempts = new Map<string, Array<number>>()
const ADMIN_WINDOW_MS = 60_000
const ADMIN_MAX_MUTATIONS = 30

export function enforcePlatformMutationRateLimit(
  actorUserId: string,
  now = Date.now()
): void {
  // Limit verified staff identities rather than trusting forwarded IP headers.
  const key = actorUserId
  const recent = (attempts.get(key) || []).filter(
    (timestamp) => now - timestamp < ADMIN_WINDOW_MS
  )
  if (recent.length >= ADMIN_MAX_MUTATIONS) {
    attempts.set(key, recent)
    throw new PlatformRequestError(
      429,
      "Too many operator mutations. Try again shortly."
    )
  }
  recent.push(now)
  attempts.set(key, recent)
}

export function resetPlatformMutationRateLimitsForTests(): void {
  attempts.clear()
}
