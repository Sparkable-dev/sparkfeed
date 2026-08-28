import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

/**
 * Get the current session (returns null if not authenticated).
 * Use this in loaders or beforeLoad for optional auth checks.
 */
export const getSession = createServerFn({ method: "GET" }).handler(
  async () => {
    const { auth } = await import("@/lib/auth");
    const headers = getRequestHeaders();
    const session = await auth.api.getSession({ headers });
    return session;
  }
);

/**
 * Ensure the user is authenticated, throwing if not.
 * Use this in server functions that require authentication.
 */
export const ensureSession = createServerFn({ method: "GET" }).handler(
  async () => {
    const { auth } = await import("@/lib/auth");
    const headers = getRequestHeaders();
    const session = await auth.api.getSession({ headers });
    if (!session) {
      throw new Error("Unauthorized");
    }
    return session;
  }
);
