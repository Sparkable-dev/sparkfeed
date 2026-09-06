import { createServerOnlyFn } from "@tanstack/react-start"
import type { ProviderId } from "@/config/ai-models"
import { DEMO_MODE as DEMO_MODE_BUILD } from "@/lib/demo"
import { sparkfeedEdition } from "@/server/entitlements/config"

/**
 * Disable AI for demo builds or when the runtime kill switch is enabled.
 * VITE_DEMO_MODE is the single demo setting at build time and runtime.
 * Always retain the build-time check: demo builds bypass customer auth, so
 * clearing the runtime value must never enable AI for anonymous visitors.
 * Changing the application mode requires a rebuild; DISABLE_AI can change
 * independently at runtime.
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
  (): boolean => DEMO_MODE_BUILD || process.env.VITE_DEMO_MODE === "true"
)

/** Which providers have credentials configured, by provider id. */
export const configuredProviders = createServerOnlyFn(
  (): Record<ProviderId, boolean> =>
    sparkfeedEdition() === "cloud"
      ? {
          openai: false,
          "vercel-gateway": !!process.env.AI_GATEWAY_API_KEY,
          openrouter: false,
        }
      : {
          openai: !!process.env.OPENAI_API_KEY,
          "vercel-gateway": !!process.env.AI_GATEWAY_API_KEY,
          openrouter: !!process.env.OPENROUTER_API_KEY,
        }
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
