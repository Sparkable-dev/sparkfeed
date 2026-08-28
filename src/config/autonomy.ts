/**
 * How much Spark AI may do without being asked.
 *
 * Lives in config rather than in the composer store because both halves need
 * it: the client renders the pill from it, and the server filters the tool set
 * with it. A three-value union is easy to duplicate and easy to let drift, and
 * a drift here means the UI promising a restriction the server does not apply.
 *
 * The ordering is the whole semantics — a level permits every tool at or below
 * its own rank, never above.
 */

export const AUTONOMY_IDS = ["read-only", "ask", "auto"] as const

export type AutonomyId = (typeof AUTONOMY_IDS)[number]

export const DEFAULT_AUTONOMY: AutonomyId = "auto"

/** Higher permits more. Used to compare a request against a tool's minimum. */
export const AUTONOMY_RANK: Record<AutonomyId, number> = {
  "read-only": 0,
  ask: 1,
  auto: 2,
}

export interface AutonomyOption {
  id: AutonomyId
  /** Shown on the composer pill — kept short so the row stays tight. */
  pill: string
  label: string
  hint: string
}

export const AUTONOMY_OPTIONS: Array<AutonomyOption> = [
  {
    id: "read-only",
    pill: "READ",
    label: "Read only",
    hint: "Answer questions. Never change anything.",
  },
  {
    id: "ask",
    pill: "ASK",
    label: "Ask first",
    hint: "May add feeds and organise, after confirming.",
  },
  {
    id: "auto",
    pill: "AUTO",
    label: "Auto",
    hint: "Add feeds, organise folders, and mark items read.",
  },
]

export function isAutonomyId(value: string): value is AutonomyId {
  return (AUTONOMY_IDS as ReadonlyArray<string>).includes(value)
}
