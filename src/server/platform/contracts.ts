import { z } from "zod"

export const listQuerySchema = z.object({
  workspaceId: z.string().max(200).optional(),
  userId: z.string().max(200).optional(),
  requestStatus: z
    .enum(["all", "pending", "in_review", "approved", "declined"])
    .default("all"),
  q: z.string().trim().max(200).default(""),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  type: z.enum(["all", "personal", "organization"]).default("all"),
  plan: z
    .enum(["all", "free", "personal_plus", "pro", "enterprise"])
    .default("all"),
  status: z
    .enum(["all", "active", "read_only", "suspended", "banned", "unverified"])
    .default("all"),
  direction: z.enum(["asc", "desc"]).default("desc"),
  days: z.coerce.number().int().min(7).max(90).default(30),
  sort: z.enum(["updated", "name", "created"]).default("updated"),
})
export type ListQuery = z.infer<typeof listQuerySchema>
export interface Page<T> {
  items: Array<T>
  total: number
  page: number
  pageSize: number
}
export const workspaceInput = z.object({
  workspaceType: z.enum(["personal", "organization"]),
  workspaceId: z.string().min(1).max(200),
})
export const overrideInput = workspaceInput.extend({
  action: z.literal("set_override"),
  planKey: z.enum(["free", "personal_plus", "pro", "enterprise"]).nullable(),
  accessRestriction: z.enum(["read_only", "suspended"]).nullable(),
  seatLimit: z.number().int().min(1).max(10000).nullable(),
  monthlyAiCredits: z.number().int().min(0).max(100000).nullable(),
  sourceUnitLimit: z.number().int().min(0).max(100000).nullable(),
  apiAccess: z.boolean().nullable(),
  mcpAccess: z.boolean().nullable(),
  reason: z.string().trim().min(1).max(500),
  expiresAt: z.iso.datetime().nullable().optional(),
  expectedRevision: z.number().int().nonnegative(),
})
export const removeOverrideInput = workspaceInput.extend({
  action: z.literal("remove_override"),
  expectedRevision: z.number().int().positive(),
  reason: z.string().trim().min(1).max(500),
})
