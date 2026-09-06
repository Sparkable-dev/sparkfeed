import { createAuthClient } from "better-auth/react"
import { organizationClient } from "better-auth/client/plugins"
import { dodopaymentsClient } from "@dodopayments/better-auth/client"
import { workspaceAccess, workspaceRoles } from "@/lib/workspace-roles"

// Default to the site's own origin in the browser so the auth client always
// talks to the same domain it was served from (e.g. https://demo.sparkfeed.dev).
// Never fall back to localhost in production — that makes every visitor's
// browser try to reach a service on THEIR OWN machine, which triggers the
// browser's "access other apps and services on this device" prompt and fails.
// VITE_AUTH_URL stays available as an explicit override for split-domain setups.
const authBaseURL =
  import.meta.env.VITE_AUTH_URL ||
  (typeof window !== "undefined"
    ? window.location.origin
    : "http://localhost:3000")

export const authClient = createAuthClient({
  baseURL: authBaseURL,
  plugins: [
    organizationClient({ ac: workspaceAccess, roles: workspaceRoles }),
    dodopaymentsClient(),
  ],
})

export const { useSession, signIn, signUp, signOut } = authClient
