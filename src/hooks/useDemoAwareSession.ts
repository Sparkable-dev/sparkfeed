import { useGuestShare } from "./guest-share-context"
import { useHydrated } from "./useHydrated"
import { useSession } from "@/lib/auth-client"
import { DEMO_MODE, DEMO_SESSION } from "@/lib/demo"
import { GUEST_SESSION } from "@/lib/guest"

/**
 * The session the UI should render, which is not always a real one.
 *
 * Order matters, and guest comes first. `useGuestShare` is only non-null inside
 * the public share page, and a visitor to a share link on the demo deployment
 * is a guest of that share rather than of the demo — the two identities read
 * alike now but are not the same thing, and only the guest one is scoped to a
 * single route. Demo mode next, because there is no `session` table there so the
 * real hook has nothing to find. A signed-in user viewing a share falls all the
 * way through to their own session, which is what they should see.
 *
 * Both hooks are called unconditionally so hook order never changes; only the
 * returned value branches.
 */
export function useDemoAwareSession() {
  const real = useSession()
  const guest = useGuestShare()
  const hydrated = useHydrated()

  if (guest) return { data: GUEST_SESSION, isPending: false, error: null }
  if (DEMO_MODE) return { data: DEMO_SESSION, isPending: false, error: null }
  return { ...real, data: hydrated ? real.data : null, isPending: !hydrated || real.isPending }
}
