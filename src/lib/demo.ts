export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true"
export const DEMO_WORKSPACE_ID = "demo-workspace"

/**
 * The identity the demo deployment renders.
 *
 * "Guest User" rather than "Demo User": the page already says DEMO MODE in the
 * sidebar and on every locked action, so the name repeating it added nothing,
 * and the home page greets people by their first name — "Good morning, Demo"
 * is not a greeting. "Guest" is.
 *
 * The email is display-only and referenced nowhere else, so it moves with the
 * name; leaving demo@ under "Guest User" would just restate the contradiction
 * one line down.
 *
 * `DEMO_WORKSPACE_ID` is a real tenancy key and is deliberately untouched.
 */
export const DEMO_SESSION = {
  user: {
    id: DEMO_WORKSPACE_ID,
    name: "Guest User",
    email: "guest@sparkfeed.app",
    image: null as string | null,
    emailVerified: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  session: {
    id: "demo-session",
    token: "demo-token",
    userId: DEMO_WORKSPACE_ID,
    // null so workspaceId resolves to user.id = "demo-workspace" via the
    // existing pattern: activeOrganizationId || user.id
    activeOrganizationId: null as string | null,
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
}
