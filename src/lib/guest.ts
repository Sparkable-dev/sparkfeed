/**
 * A stand-in identity for someone reading a public share link.
 *
 * Shaped like `DEMO_SESSION` in `./demo`, and for the same reason: the sidebar
 * renders a user, and giving it something real-looking beats branching every
 * field. Unlike demo mode this is never a deployment-wide switch — a guest is a
 * property of one route, so nothing reads it directly. `useDemoAwareSession`
 * hands it back only inside a `GuestShareProvider`.
 *
 * `name` must stay non-empty: `app-sidebar` indexes into it to build the avatar
 * initial, and `""[0]` is undefined.
 */
export const GUEST_USER_ID = "guest"

export const GUEST_SESSION = {
  user: {
    id: GUEST_USER_ID,
    name: "Guest",
    email: "Not signed in",
    image: null as string | null,
    emailVerified: false,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  session: {
    id: "guest-session",
    token: "guest-token",
    userId: GUEST_USER_ID,
    activeOrganizationId: null as string | null,
    expiresAt: new Date(0).toISOString(),
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
}
