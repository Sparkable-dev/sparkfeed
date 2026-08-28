import { createServerOnlyFn } from "@tanstack/react-start"
import type { ProviderId } from "@/config/ai-models"
import { DEMO_MODE as DEMO_MODE_BUILD } from "@/lib/demo"

/**
 * Whether Spark AI is switched off for this deployment.
 *
 * The route this replaced gated *only* on `import.meta.env.VITE_DEMO_MODE` — a
 * build-time constant from the client env namespace. Vite inlines it, so it
 * could not be flipped at deploy time, and a client-side constant is a poor
 * sole basis for a server-side authorization decision. The runtime flags below
 * fix that: setting either on Railway takes effect on restart, not on rebuild.
 *
 * The build-time constant is still checked, and dropping it would be a
 * regression rather than a cleanup. `resolveWorkspaceContext*` short-circuits
 * on that same constant and hands back the demo workspace without consulting
 * any session, so on a demo deployment the auth gate in the route always
 * passes. If this returned false there, demo would go from "AI locked" to "AI
 * open to anyone" — the exact opposite of what the flag means. So: build-time
 * OR runtime, never one replacing the other.
 *
 * `DEMO_MODE` is the server-side twin of `VITE_DEMO_MODE`; set both together
 * (see .env.example).
 */
export const aiDisabled = createServerOnlyFn(
  (): boolean => isDemo() || process.env.DISABLE_AI === "true"
)

/**
 * Whether this is a demo deployment, as opposed to AI simply being switched off.
 *
 * Only used to choose the wording of the 403 — a demo visitor should be told to
 * sign up, a self-hoster with DISABLE_AI set should not.
 */
export const isDemo = createServerOnlyFn(
  (): boolean => DEMO_MODE_BUILD || process.env.DEMO_MODE === "true"
)

/** Which providers have credentials configured, by provider id. */
export const configuredProviders = createServerOnlyFn(
  (): Record<ProviderId, boolean> => ({
    openai: !!process.env.OPENAI_API_KEY,
    "vercel-gateway": !!process.env.AI_GATEWAY_API_KEY,
    openrouter: !!process.env.OPENROUTER_API_KEY,
  })
)

/**
 * The model id to default to, overridable per-deployment.
 *
 * Deliberately *not* the old `AI_MODEL`, which pinned an arbitrary string and so
 * bypassed the catalogue allowlist by design. This one is validated against
 * `models[]` by the caller and ignored (with a warning) if it does not match.
 */
export const defaultModelOverride = createServerOnlyFn(
  (): string | undefined => process.env.AI_DEFAULT_MODEL || undefined
)
