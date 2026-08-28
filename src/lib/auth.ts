import { betterAuth } from "better-auth"
import { APIError } from "better-auth/api"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { tanstackStartCookies } from "better-auth/tanstack-start"
import { organization } from "better-auth/plugins/organization"
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

const dbProvider = import.meta.env.VITE_DEMO_MODE === "true" ? "sqlite" : "pg"

export const auth = betterAuth({
  database: drizzleAdapter(db as Parameters<typeof drizzleAdapter>[0], {
    provider: dbProvider,
    schema: { ...schema },
  }),
  user: {
    deleteUser: {
      enabled: true,
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
      },
    },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 10,
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
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
    organization({
      creatorRole: "owner",
      membershipLimit: COMMUNITY_USER_LIMIT,
      allowUserToCreateOrganization: async (user) =>
        canUserCreateWorkspace(user.id),
      sendInvitationEmail: async ({ email, invitation }) => {
        console.log(`[DEBUG] sendInvitationEmail hook triggered for ${email}`)
        try {
          const inviteUrl = `${process.env.BETTER_AUTH_URL || process.env.APP_URL || "http://localhost:3000"}/invite?token=${invitation.id}`
          await sendInviteEmail(email, inviteUrl)
          console.log(`[DEBUG] sendInviteEmail successful for ${email}`)
        } catch (err) {
          console.error(`[ERROR] sendInviteEmail failed for ${email}:`, err)
          throw err
        }
      },
    }),
    tanstackStartCookies(), // must be last plugin
  ],
})
