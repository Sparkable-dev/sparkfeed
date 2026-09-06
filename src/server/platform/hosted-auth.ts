import { dash } from "@better-auth/infra"
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
} from "better-auth/api"
import { setSessionCookie } from "better-auth/cookies"
import { z } from "zod"
import { redactHostedCredentials } from "./hosted-projection"
import {
  createHostedOrganization,
  deleteHostedOrganizations,
  deleteHostedUsers,
  hostedMembership,
  recordHostedAction,
} from "./hosted-operations"

export function hostedDashboardEnabled(env = process.env) {
  return (
    env.SPARKFEED_EDITION === "cloud" &&
    env.SPARKFEED_BETTER_AUTH_DASHBOARD === "true"
  )
}

/** Keep the vendor's JWT middleware. Replace only domain-sensitive handlers.
 * API shapes are pinned to @better-auth/infra 0.4.5, not inferred from its UI.
 * https://better-auth.com/docs/infrastructure/getting-started
 */
export function hostedDashboardPlugin() {
  if (!hostedDashboardEnabled()) return null
  if (!process.env.BETTER_AUTH_API_KEY)
    throw new Error(
      "BETTER_AUTH_API_KEY is required when the hosted dashboard is enabled."
    )
  const plugin = dash({
    apiKey: process.env.BETTER_AUTH_API_KEY,
    activityTracking: { enabled: true },
  })
  const e = plugin.endpoints
  return {
    ...plugin,
    endpoints: {
      ...e,
      getDashUser: createAuthEndpoint(
        e.getDashUser.path,
        e.getDashUser.options,
        async (ctx) =>
          redactHostedCredentials(
            await e.getDashUser({
              ...ctx,
              asResponse: false,
              returnHeaders: false,
              returnStatus: false,
            })
          )
      ),
      dashImpersonateUser: createAuthEndpoint(
        e.dashImpersonateUser.path,
        e.dashImpersonateUser.options,
        async (ctx) => {
          const payload = z
            .object({
              userId: z.string(),
              redirectUrl: z.url(),
              impersonatedBy: z.string().optional(),
            })
            .parse(ctx.context.payload)
          const destination = new URL(payload.redirectUrl)
          if (destination.origin !== new URL(ctx.context.baseURL).origin)
            throw new APIError("FORBIDDEN", {
              message: "Support sessions stay on the customer application.",
            })
          const account = await ctx.context.internalAdapter.findUserById(
            payload.userId
          )
          if (!account)
            throw new APIError("NOT_FOUND", { message: "User not found" })
          const supportSession =
            await ctx.context.internalAdapter.createSession(
              account.id,
              true,
              {
                expiresAt: new Date(Date.now() + 10 * 60 * 1000),
                impersonatedBy:
                  payload.impersonatedBy || "integration:better-auth-dashboard",
              },
              true
            )
          if (!supportSession)
            throw new APIError("INTERNAL_SERVER_ERROR", {
              message: "Could not create support session",
            })
          await recordHostedAction("start_support_session", account.id)
          await setSessionCookie(
            ctx,
            { session: supportSession, user: account },
            true
          )
          throw ctx.redirect(destination.toString())
        }
      ),
      // Recovery stays with verified customer flows; staff do not receive
      // authenticator seeds, backup codes, or direct password setters.
      setDashPassword: createAuthEndpoint(
        e.setDashPassword.path,
        e.setDashPassword.options,
        () => {
          throw new APIError("FORBIDDEN", {
            message: "Send a password reset instead.",
          })
        }
      ),
      dashEnableTwoFactor: createAuthEndpoint(
        e.dashEnableTwoFactor.path,
        e.dashEnableTwoFactor.options,
        () => {
          throw new APIError("FORBIDDEN", {
            message: "Customer two-factor authentication is not enabled.",
          })
        }
      ),
      dashCompleteTwoFactorSetup: createAuthEndpoint(
        e.dashCompleteTwoFactorSetup.path,
        e.dashCompleteTwoFactorSetup.options,
        () => {
          throw new APIError("FORBIDDEN", {
            message: "Customer two-factor authentication is not enabled.",
          })
        }
      ),
      dashViewTwoFactorTotpUri: createAuthEndpoint(
        e.dashViewTwoFactorTotpUri.path,
        e.dashViewTwoFactorTotpUri.options,
        () => {
          throw new APIError("FORBIDDEN", {
            message: "Authenticator secrets cannot be viewed by staff.",
          })
        }
      ),
      dashDisableTwoFactor: createAuthEndpoint(
        e.dashDisableTwoFactor.path,
        e.dashDisableTwoFactor.options,
        () => {
          throw new APIError("FORBIDDEN", {
            message: "Customer two-factor authentication is not enabled.",
          })
        }
      ),
      dashGenerateBackupCodes: createAuthEndpoint(
        e.dashGenerateBackupCodes.path,
        e.dashGenerateBackupCodes.options,
        () => {
          throw new APIError("FORBIDDEN", {
            message: "Recovery codes belong to the customer.",
          })
        }
      ),
      deleteDashUser: createAuthEndpoint(
        e.deleteDashUser.path,
        e.deleteDashUser.options,
        async (ctx) => {
          const { userId } = z
            .object({ userId: z.string() })
            .parse(ctx.context.payload)
          await deleteHostedUsers([userId])
        }
      ),
      deleteManyDashUsers: createAuthEndpoint(
        e.deleteManyDashUsers.path,
        e.deleteManyDashUsers.options,
        async (ctx) => {
          const { userIds } = z
            .object({ userIds: z.array(z.string()).max(100) })
            .parse(ctx.context.payload)
          return deleteHostedUsers(userIds)
        }
      ),
      deleteDashOrganization: createAuthEndpoint(
        e.deleteDashOrganization.path,
        e.deleteDashOrganization.options,
        async (ctx) => {
          const { organizationId } = z
            .object({ organizationId: z.string() })
            .parse(ctx.context.payload)
          if (organizationId !== ctx.body.organizationId)
            throw new APIError("BAD_REQUEST", { message: "Workspace mismatch" })
          await deleteHostedOrganizations([organizationId])
          return { success: true }
        }
      ),
      deleteManyDashOrganizations: createAuthEndpoint(
        e.deleteManyDashOrganizations.path,
        e.deleteManyDashOrganizations.options,
        async (ctx) => {
          const { organizationIds } = z
            .object({ organizationIds: z.array(z.string()).max(100) })
            .parse(ctx.context.payload)
          return deleteHostedOrganizations(organizationIds)
        }
      ),
      createDashOrganization: createAuthEndpoint(
        e.createDashOrganization.path,
        e.createDashOrganization.options,
        async (ctx) => {
          const { userId } = z
            .object({ userId: z.string() })
            .parse(ctx.context.payload)
          const input = z
            .object({
              name: z.string().trim().min(1).max(100),
              slug: z
                .string()
                .regex(/^[a-z0-9][a-z0-9-]*$/)
                .max(100),
              logo: z.url().nullable().optional(),
            })
            .parse(ctx.body)
          return createHostedOrganization(userId, input)
        }
      ),
      addDashMember: createAuthEndpoint(
        e.addDashMember.path,
        e.addDashMember.options,
        async (ctx) => {
          const { organizationId } = z
            .object({ organizationId: z.string() })
            .parse(ctx.context.payload)
          return hostedMembership(organizationId, {
            action: "add",
            userId: ctx.body.userId,
            role: ctx.body.role,
          })
        }
      ),
      removeDashMember: createAuthEndpoint(
        e.removeDashMember.path,
        e.removeDashMember.options,
        async (ctx) => {
          const { organizationId } = z
            .object({ organizationId: z.string() })
            .parse(ctx.context.payload)
          return hostedMembership(organizationId, {
            action: "remove",
            memberId: ctx.body.memberId,
          })
        }
      ),
      updateDashMemberRole: createAuthEndpoint(
        e.updateDashMemberRole.path,
        e.updateDashMemberRole.options,
        async (ctx) => {
          const { organizationId } = z
            .object({ organizationId: z.string() })
            .parse(ctx.context.payload)
          return hostedMembership(organizationId, {
            action: "role",
            memberId: ctx.body.memberId,
            role: ctx.body.role,
          })
        }
      ),
      // Generic reads can expose password hashes, tokens or MFA secrets. Use
      // the vendor's purpose-built projections, never its raw adapter endpoint.
      dashExecuteAdapter: createAuthEndpoint(
        e.dashExecuteAdapter.path,
        e.dashExecuteAdapter.options,
        () => {
          throw new APIError("FORBIDDEN", {
            message: "Use the dedicated user and organization controls.",
          })
        }
      ),
    },
    hooks: {
      ...plugin.hooks,
      after: [
        ...(plugin.hooks?.after ?? []),
        {
          matcher: (ctx: { path?: string; request?: Request }) =>
            Boolean(ctx.path?.startsWith("/dash/")) &&
            (ctx.request?.method !== "GET" ||
              Boolean(ctx.path?.includes("impersonate"))),
          handler: createAuthMiddleware(async (ctx) => {
            if (ctx.context.returned instanceof Error) return
            const payload = (
              ctx.context as unknown as { payload?: Record<string, unknown> }
            ).payload
            const target =
              typeof payload?.organizationId === "string"
                ? payload.organizationId
                : typeof payload?.userId === "string"
                  ? payload.userId
                  : "hosted-dashboard"
            await recordHostedAction(ctx.path, target)
          }),
        },
      ],
    },
  }
}
