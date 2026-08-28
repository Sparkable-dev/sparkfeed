import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { EffortId } from "@/config/ai-models"
import type { AutonomyId } from "@/config/autonomy"
import {
  DEFAULT_MODEL_ID,
  getModel,
  resolveEffortFor,
} from "@/config/ai-models"

// Autonomy now means something on the server — it filters the tool set — so its
// definition moved to @/config/autonomy, shared by both halves. Re-exported here
// because the composer components already import it from this module.

export {
  AUTONOMY_OPTIONS,
  type AutonomyId,
  type AutonomyOption,
} from "@/config/autonomy"

interface AIComposerPrefs {
  modelId: string
  effort: EffortId | null
  autonomy: AutonomyId
  /**
   * Skill pinned to the next message, or null. One-shot: cleared after send,
   * because a skill is a procedure for *this* request, and leaving it latched
   * would silently reshape every follow-up.
   */
  activeSkillId: string | null
  setModel: (modelId: string, effort?: EffortId) => void
  setEffort: (effort: EffortId) => void
  setAutonomy: (autonomy: AutonomyId) => void
  setActiveSkill: (id: string | null) => void
}

const defaultModel = getModel(DEFAULT_MODEL_ID)

/**
 * Composer preferences, persisted across reloads.
 *
 * `modelId`, `effort` and `autonomy` all reach the server, and all three are
 * re-validated there — a stale model id in localStorage (say, after a model is
 * retired) falls back rather than erroring, and autonomy is re-applied to the
 * tool set server-side rather than trusted from the request.
 *
 * There is deliberately no per-tool state. An earlier version kept an
 * `enabledTools` array behind switches in the `+` menu; nothing ever read it,
 * because which tools the model gets is decided by `autonomy` and by the
 * session's scopes. Storing it only made the menu look like it did something.
 */
export const useAIComposerPrefs = create<AIComposerPrefs>()(
  persist(
    (set, get) => ({
      modelId: DEFAULT_MODEL_ID,
      effort: defaultModel ? resolveEffortFor(defaultModel, undefined) : null,
      autonomy: "auto",
      activeSkillId: null,

      setModel: (modelId, effort) => {
        const model = getModel(modelId)
        if (!model) return
        // Effort is per-model: switching from one that offers "minimal" to one
        // that does not must not leave an unsupported value selected.
        set({ modelId, effort: resolveEffortFor(model, effort) })
      },

      setEffort: (effort) => {
        const model = getModel(get().modelId)
        if (!model) return
        set({ effort: resolveEffortFor(model, effort) })
      },

      setAutonomy: (autonomy) => set({ autonomy }),

      setActiveSkill: (activeSkillId) => set({ activeSkillId }),
    }),
    {
      name: "spark-ai-composer",
      // `activeSkillId` is deliberately excluded: it belongs to one message,
      // and restoring it on reload would silently apply a skill the user
      // picked days ago to whatever they type next.
      partialize: (state) => ({
        modelId: state.modelId,
        effort: state.effort,
        autonomy: state.autonomy,
      }),
      // A persisted model that no longer exists (or an effort it never
      // supported) is repaired on load instead of being handed to the server.
      onRehydrateStorage: () => (state) => {
        if (!state) return
        const model = getModel(state.modelId)
        if (!model) {
          state.modelId = DEFAULT_MODEL_ID
          const fallback = getModel(DEFAULT_MODEL_ID)
          state.effort = fallback ? resolveEffortFor(fallback, undefined) : null
          return
        }
        state.effort = resolveEffortFor(model, state.effort ?? undefined)
      },
    }
  )
)
