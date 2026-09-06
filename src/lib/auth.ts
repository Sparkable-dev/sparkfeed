import { betterAuth } from "better-auth"
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { tanstackStartCookies } from "better-auth/tanstack-start"
import { organization } from "better-auth/plugins/organization"
import { customerAccountSecurity } from "@/lib/auth-security"
import { hostedDashboardPlugin } from "@/server/platform/hosted-auth"
import { db } from "@/db/index"
import * as schema from "@/db/schema"
import {
  sendInviteEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "@/lib/email"
import { COMMUNITY_USER_LIMIT } from "@/lib/community-policy"
import {
  canUserCreateWorkspace,
  registrationDecision,
} from "@/server/community-policy"
import {
  assertInvitationRoleAllowed,
  assertMemberRemovalAllowed,
  assertMemberRoleChangeAllowed,
  assertOrganizationInvitationCapacity,
  assertOrganizationManagementAllowed,
  clearRemovedOrganizationSessions,
} from "@/server/entitlements/organization"
import { sparkfeedEdition } from "@/server/entitlements/config"
import { ensureCloudFreeAccount } from "@/server/entitlements/credits"
import {
  organizationWorkspaceRef,
  personalWorkspaceRef,
} from "@/lib/workspaces"
import { resolveEntitlements } from "@/server/entitlements/resolve"
import {
  assertPersonalPortalAllowed,
  dodoBetterAuthPlugin,
} from "@/server/billing/dodo-auth"
import { resolveAuthConfig } from "@/lib/auth-config"
import { workspaceAccess, workspaceRoles } from "@/lib/workspace-roles"

const dbProvider = import.meta.env.VITE_DEMO_MODE === "true" ? "sqlite" : "pg"
const dodoPlugin = dodoBetterAuthPlugin()
const hostedPlugin = hostedDashboardPlugin()
const authConfig = resolveAuthConfig()
const cloudAuth = sparkfeedEdition() === "cloud"

export const auth = betterAuth({
  appName: "Sparkfeed",
  trustedOrigins: authConfig.trustedOrigins,
  advanced: {
    cookiePrefix: authConfig.cookiePrefix,
    useSecureCookies: process.env.NODE_ENV === "production",
  },
  database: drizzleAdapter(db as Parameters<typeof drizzleAdapter>[0], {
    provider: dbProvider,
    schema: { ...schema },
  }),
  user: {
    deleteUser: {
      enabled: true,
      beforeDelete: async (deletingUser) => {
        const { hasManagedPersonalPlusSubscription, ownedWorkspacesForUser } =
          await import("@/server/account-deletion")
        const ownedWorkspaces = await ownedWorkspacesForUser(
          db,
          deletingUser.id
        )
        if (ownedWorkspaces.length > 0) {
          throw new APIError("FORBIDDEN", {
            message:
              "Transfer ownership or delete these workspaces before deleting your account: " +
              ownedWorkspaces.map((workspace) => workspace.name).join(", "),
          })
        }

        if (await hasManagedPersonalPlusSubscription(db, deletingUser.id)) {
          throw new APIError("FORBIDDEN", {
            message:
              "Cancel Personal+ and wait for your personal workspace to return to Free before deleting your account.",
          })
        }
      },
      afterDelete: async (deletedUser) => {
        const { deletePersonalWorkspaceData } =
          await import("@/server/account-deletion")
        await deletePersonalWorkspaceData(db, deletedUser.id)
      },
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (newUser) => {
          const decision = await registrationDecision(newUser.email)
          if (!decision.allowed) {
            throw new APIError("FORBIDDEN", {
              message:
                decision.reason === "instance-limit"
                  ? `Community Edition supports up to ${COMMUNITY_USER_LIMIT} registered people.`
                  : "Registration is invite-only on this Sparkfeed instance.",
            })
          }
          return { data: newUser }
        },
        after: async (newUser) => {
          if (sparkfeedEdition() !== "cloud") return
          await ensureCloudFreeAccount(
            personalWorkspaceRef(newUser.id),
            newUser.id,
            newUser.emailVerified
          )
        },
      },
      update: {
        after: async (updatedUser) => {
          if (sparkfeedEdition() !== "cloud") return
          await ensureCloudFreeAccount(
            personalWorkspaceRef(updatedUser.id),
            updatedUser.id,
            updatedUser.emailVerified
          )
        },
      },
    },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 10,
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // Customer roles never authorize platform administration.
      if (ctx.path.startsWith("/admin/")) {
        throw new APIError("NOT_FOUND", { message: "Not found" })
      }
      if (!ctx.path.startsWith("/dodopayments/customer/")) return
      const session = await getSessionFromCtx(ctx)
      if (!session?.user.id || !session.user.emailVerified) {
        throw new APIError("UNAUTHORIZED", {
          message: "A verified account is required to manage billing.",
        })
      }
      try {
        await assertPersonalPortalAllowed(session.user.id)
      } catch (error) {
        throw new APIError("FORBIDDEN", {
          message:
            error instanceof Error
              ? error.message
              : "The billing portal is unavailable.",
        })
      }
    }),
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    customSyntheticUser: ({ coreFields, additionalFields, id }) => ({
      ...coreFields,
      role: "user",
      banned: false,
      banReason: null,
      banExpires: null,
      ...additionalFields,
      id,
    }),
    sendResetPassword: async ({ user, url }) => {
      console.log(`[DEBUG] sendResetPassword hook triggered for ${user.email}`)
      await sendPasswordResetEmail(user.email, url)
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: false,
    sendVerificationEmail: async ({ user, url }) => {
      console.log(`[DEBUG] sendVerificationEmail triggered for ${user.email}`)
      try {
        // Parse the token from the Better Auth endpoint URL and point it to our UI route
        const parsedUrl = new URL(url)
        const token = parsedUrl.searchParams.get("token") || ""
        const clientRouteUrl = `${parsedUrl.origin}/verify-email?token=${token}`

        await sendVerificationEmail(user.email, clientRouteUrl)
        console.log(
          `[DEBUG] sendVerificationEmail successful for ${user.email}`
        )
      } catch (err) {
        console.error(
          `[ERROR] sendVerificationEmail failed for ${user.email}:`,
          err
        )
        throw err
      }
    },
  },
  plugins: [
    ...(cloudAuth ? [customerAccountSecurity()] : []),
    ...(dodoPlugin ? [dodoPlugin] : []),
    organization({
      creatorRole: "owner",
      ac: workspaceAccess,
      roles: workspaceRoles,
      membershipLimit: async (_user, org) => {
        const entitlements = await resolveEntitlements(
          organizationWorkspaceRef(org.id),
          {
            type: "system",
            userId: null,
            emailVerified: false,
            workspaceId: org.id,
            demo: false,
          }
        )
        return entitlements.seatCapacity ?? 100_000
      },
      requireEmailVerificationOnInvitation: true,
      allowUserToCreateOrganization: async (user) =>
        canUserCreateWorkspace(user.id),
      organizationHooks: {
        beforeUpdateOrganization: async ({ organization: org, user }) => {
          await assertOrganizationManagementAllowed(org.id, user)
        },
        beforeDeleteOrganization: async ({ organization: org, user }) => {
          await assertOrganizationManagementAllowed(org.id, user)
        },
        beforeAddMember: async ({ member, user }) => {
          await assertOrganizationManagementAllowed(member.organizationId, user)
        },
        beforeCreateInvitation: async ({ invitation, inviter }) => {
          await assertOrganizationManagementAllowed(
            invitation.organizationId,
            inviter
          )
          await assertOrganizationInvitationCapacity(
            invitation.organizationId,
            inviter,
            invitation.email
          )
          await assertInvitationRoleAllowed({
            organizationId: invitation.organizationId,
            actorUserId: inviter.id,
            invitedRole: invitation.role,
          })
        },
        beforeAcceptInvitation: async ({ invitation, user }) => {
          await assertOrganizationManagementAllowed(
            invitation.organizationId,
            user
          )
        },
        beforeCancelInvitation: async ({ invitation, cancelledBy }) => {
          await assertOrganizationManagementAllowed(
            invitation.organizationId,
            cancelledBy
          )
        },
        beforeRemoveMember: async ({ member, user }) => {
          await assertOrganizationManagementAllowed(member.organizationId, user)
          await assertMemberRemovalAllowed({
            organizationId: member.organizationId,
            actorUserId: user.id,
            targetRole: member.role,
          })
        },
        beforeUpdateMemberRole: async ({ member, newRole, user }) => {
          await assertOrganizationManagementAllowed(member.organizationId, user)
          await assertMemberRoleChangeAllowed({
            organizationId: member.organizationId,
            actorUserId: user.id,
            targetRole: member.role,
            newRole,
          })
        },
        afterRemoveMember: async ({ member }) => {
          await clearRemovedOrganizationSessions(
            member.userId,
            member.organizationId
          )
        },
      },
      sendInvitationEmail: async ({ email, invitation }) => {
        console.log(`[DEBUG] sendInvitationEmail hook triggered for ${email}`)
        try {
          const baseUrl =
            process.env.BETTER_AUTH_URL ||
            process.env.APP_URL ||
            "http://localhost:3000"
          const inviteUrl = `${baseUrl}/invite?token=${encodeURIComponent(invitation.id)}&email=${encodeURIComponent(email)}`
          await sendInviteEmail(email, inviteUrl)
          console.log(`[DEBUG] sendInviteEmail successful for ${email}`)
        } catch (err) {
          console.error(`[ERROR] sendInviteEmail failed for ${email}:`, err)
          throw err
        }
      },
    }),
    ...(hostedPlugin ? [hostedPlugin] : []),
    tanstackStartCookies(), // must be last plugin
  ],
})
