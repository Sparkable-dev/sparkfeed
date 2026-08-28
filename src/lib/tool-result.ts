/**
 * What a tool returns when it fails, and how to spot it.
 *
 * This lives in `lib/` rather than beside the tool result types in
 * `src/server/tools/types.ts` for one concrete reason: it is a *value*, and the
 * renderers need it at runtime. A value import of anything under `@/server`
 * makes Vite load that module for the browser — and while `types.ts` contains
 * only `import type` lines, relying on every future edit to keep it that way is
 * a trap. Keeping the runtime half outside `@/server` means the client never
 * has a reason to reach in at all; the type-only imports stay erased.
 *
 * Errors are *returned* by tools, not thrown: a thrown tool error aborts the
 * whole stream, while a returned one is something the model can read, explain
 * and retry around. See `src/server/ai/tools.ts`.
 */
export interface ToolErrorResult {
  error: { code: string; message: string }
}

export function isToolError(value: unknown): value is ToolErrorResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as ToolErrorResult).error?.message === "string"
  )
}
