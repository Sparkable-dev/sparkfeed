export const EDITIONS = ["community", "cloud"] as const
export type SparkfeedEdition = (typeof EDITIONS)[number]

export const PLAN_KEYS = ["free", "personal_plus", "pro", "enterprise"] as const
export type PlanKey = (typeof PLAN_KEYS)[number]
export type EntitlementPlan = "community" | PlanKey

export const BILLING_SOURCES = ["free", "manual", "dodo"] as const
export type BillingSource = (typeof BILLING_SOURCES)[number]

export const SUBSCRIPTION_STATUSES = [
  "free",
  "checkout_pending",
  "active",
  "past_due",
  "canceled",
] as const
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number]
export type BillingStatus = "not_applicable" | SubscriptionStatus

export const WORKSPACE_ACCESS_STATES = [
  "active",
  "read_only",
  "suspended",
] as const
export type WorkspaceAccessState = (typeof WORKSPACE_ACCESS_STATES)[number]

export const BILLING_INTERVALS = ["monthly", "annual"] as const
export type BillingInterval = (typeof BILLING_INTERVALS)[number]

export const CREDIT_ENTRY_TYPES = [
  "grant",
  "reservation",
  "settlement",
  "adjustment",
  "expiry",
  "refund",
] as const
export type CreditEntryType = (typeof CREDIT_ENTRY_TYPES)[number]

export const CREDIT_BUCKETS = ["free", "paid"] as const
export type CreditBucket = (typeof CREDIT_BUCKETS)[number]

export const USAGE_METRICS = ["source_units", "spark_ai_credits"] as const
export type UsageMetric = (typeof USAGE_METRICS)[number]

export const WEBHOOK_PROCESSING_STATUSES = [
  "pending",
  "processing",
  "processed",
  "failed",
] as const
export type WebhookProcessingStatus =
  (typeof WEBHOOK_PROCESSING_STATUSES)[number]

export type WorkspaceRef =
  { type: "personal"; id: string } | { type: "organization"; id: string }

export type Principal =
  | {
      type: "session"
      userId: string
      emailVerified: boolean
      workspaceId: string
      demo: false
    }
  | {
      type: "api_key"
      keyId: string
      userId: string | null
      emailVerified: boolean
      workspaceId: string
      demo: false
    }
  | {
      type: "demo"
      userId: null
      emailVerified: false
      workspaceId: string
      demo: true
    }
  | {
      type: "system"
      userId: null
      emailVerified: false
      workspaceId: string
      demo: false
    }

export interface EntitlementOverrides {
  seatLimit: number | null
  monthlyAiCredits: number | null
  sourceUnitLimit: number | null
  apiAccess: boolean | null
  mcpAccess: boolean | null
}

export interface ResolvedEntitlements {
  plan: EntitlementPlan
  billingStatus: BillingStatus
  accessState: WorkspaceAccessState
  seatCapacity: number | null
  sourceUnitCapacity: number | null
  monthlySparkAiCredits: number | null
  sparkAiCreditBalance: number | null
  canCreateOrganizations: boolean
  canManageInvitations: boolean
  apiAccess: boolean
  mcpAccess: boolean
  managedAiAccess: boolean
}
