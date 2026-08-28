import { DEFAULT_SCOPES, DEMO_SCOPES } from "../api/principal"
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
 * - **`plan` is hard-coded.** Sessions have no plan lookup yet; entitlements
 *   are a later piece of work. `getWorkspaceInfo` echoes this value, so it is
 *   visible rather than hidden, and it gates nothing today.
 *
 * The demo branch is not a second line of defence, it is the only one that
 * matters: `DEMO_SCOPES` carries no write scope, so no request body — whatever
 * autonomy it claims — can produce a principal that mutates anything.
 */
export function principalFromWorkspaceContext(
  context: WorkspaceContext
): ApiPrincipal {
  return {
    keyId: "session",
    workspaceId: context.workspaceId,
    plan: "pro",
    scopes: context.demo ? DEMO_SCOPES : [...DEFAULT_SCOPES, "feeds:write"],
    demo: context.demo,
  }
}
