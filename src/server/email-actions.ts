import { createServerFn } from "@tanstack/react-start"
import { and, eq, gt } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db/index"
import { invitation, user } from "@/db/schema"

const APP_URL = process.env.APP_URL || "http://localhost:3000"

/**
 * The invitation id is an opaque Better Auth token. This read only decides
 * whether the recipient should sign in or create an account; acceptance still
 * goes through Better Auth and requires the verified recipient session.
 */
export const getInvitationSignupHint = createServerFn({ method: "GET" })
  .validator(z.object({ invitationId: z.string().min(1), email: z.email() }))
  .handler(async ({ data }) => {
    const normalizedEmail = data.email.toLowerCase()
    const [pending] = await db
      .select({ email: invitation.email })
      .from(invitation)
      .where(
        and(
          eq(invitation.id, data.invitationId),
          eq(invitation.status, "pending"),
          gt(invitation.expiresAt, new Date())
        )
      )
      .limit(1)

    if (!pending || pending.email.toLowerCase() !== normalizedEmail) {
      throw new Error("Invalid or expired invitation link")
    }

    const [existing] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, normalizedEmail))
      .limit(1)

    return { email: pending.email, userExists: Boolean(existing) }
  })

export const requestPasswordReset = createServerFn({ method: "POST" })
  .validator(z.email())
  .handler(async ({ data: email }) => {
    const [existing] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email))
      .limit(1)

    if (!existing) return { success: true }

    const { auth } = await import("@/lib/auth")
    await auth.api.requestPasswordReset({
      body: {
        email,
        redirectTo: `${APP_URL}/reset-password`,
      },
    })
    return { success: true }
  })
