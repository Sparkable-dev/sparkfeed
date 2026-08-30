import { DEFAULT_SCOPES, DEMO_SCOPES } from "../api/principal"
import { resolveEntitlements } from "../entitlements/resolve"
import type { ApiPrincipal } from "../api/principal"
import type { WorkspaceContext } from "../services/context"

/**
 * A signed-in browser session, expressed as an `ApiPrincipal`.
 *
 * The services layer knows exactly one authentication concept — `ApiPrincipal`
 * — and it was built for API keys. The chat runs off a better-auth session
 * instead, so something has to translate. Doing it here, once, is what lets the
 * chat reuse every service and every tool without a parallel implementation.
 *
 * Two deliberate choices:
 *
 * - **`feeds:write` is added.** `DEFAULT_SCOPES` is the default for a *minted
 *   API key*, where withholding source mutation from a long-lived token is
 *   sensible. A session is the user themselves, already able to add feeds by
 *   clicking, so withholding it here would only mean the agent cannot do what
 *   the person driving it can.
 *
 * - **`plan` comes from the entitlement authority.** The value exposed by
 *   `getWorkspaceInfo` is the same value used by the server gates.
 *
 * The demo branch is not a second line of defence, it is the only one that
 * matters: `DEMO_SCOPES` carries no write scope, so no request body — whatever
 * autonomy it claims — can produce a principal that mutates anything.
 */
export async function principalFromWorkspaceContext(
  context: WorkspaceContext
): Promise<ApiPrincipal> {
  if (!context.workspace || !context.workspaceId) {
    throw new Error("A workspace is required to create a principal.")
  }

  const entitlementPrincipal = context.demo
    ? {
        type: "demo" as const,
        userId: null,
        emailVerified: false as const,
        workspaceId: context.workspaceId,
        demo: true as const,
      }
    : {
        type: "session" as const,
        userId: context.userId!,
        emailVerified: context.emailVerified,
        workspaceId: context.workspaceId,
        demo: false as const,
      }
  const entitlements = await resolveEntitlements(
    context.workspace,
    entitlementPrincipal
  )

  return {
    keyId: "session",
    userId: context.userId,
    workspaceId: context.workspaceId,
    plan: entitlements.plan,
    entitlements,
    scopes: context.demo ? DEMO_SCOPES : [...DEFAULT_SCOPES, "feeds:write"],
    demo: context.demo,
  }
}
