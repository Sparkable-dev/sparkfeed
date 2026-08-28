import { randomUUID } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db/index";
import { invites, member, passwordResets, user, verification } from "@/db/schema";
import { sendInviteEmail } from "@/lib/email";

const APP_URL = process.env.APP_URL || "http://localhost:3000";

export const inviteUser = createServerFn({ method: "POST" })
  .validator((data: { email: string, workspaceId: string, role: string }) => data)
  .handler(async ({ data }) => {
    const { auth } = await import("@/lib/auth");
    const { getRequestHeaders } = await import("@tanstack/react-start/server");
    const headers = getRequestHeaders();
    const session = await auth.api.getSession({ headers });
    if (!session) throw new Error("Unauthorized");

    const [callerMember] = await db.select({ role: member.role })
      .from(member)
      .where(
        and(
          eq(member.userId, session.user.id),
          eq(member.organizationId, data.workspaceId)
        )
      )
      .limit(1);

    if (!callerMember ||
      !['owner', 'admin'].includes(callerMember.role)) {
      throw new Error(
        "Only admins and owners can invite users"
      );
    }

    try {
      // CHECK 1 — Already pending invite
      const pendingInvite = await db.select()
        .from(invites)
        .where(
          and(
            eq(invites.email, data.email),
            eq(invites.workspaceId, data.workspaceId),
            isNull(invites.usedAt),
            gt(invites.expiresAt, new Date())
          )
        )
        .limit(1);

      if (pendingInvite.length > 0) {
        throw new Error(
          "This email has already been invited and the invitation is still pending"
        );
      }

      // CHECK 2 — Already a workspace member
      const existingMember = await db.select({ id: member.id })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .where(
          and(
            eq(user.email, data.email),
            eq(member.organizationId, data.workspaceId)
          )
        )
        .limit(1);

      if (existingMember.length > 0) {
        throw new Error(
          "This user is already a member of your workspace"
        );
      }

      const token = randomUUID();
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 48);

      await db.insert(invites).values({
        id: randomUUID(),
        email: data.email,
        workspaceId: data.workspaceId,
        role: data.role,
        token,
        expiresAt,
      });

      const inviteLink = `${APP_URL}/invite?token=${token}`;
      await sendInviteEmail(data.email, inviteLink);
      return { success: true };
    } catch (err: any) {
      console.error("[ERROR] inviteUser failed:", err);
      throw err;
    }
  });

export const revokeInvite = createServerFn({
  method: "POST"
})
  .validator((data: { inviteId: string }) => data)
  .handler(async ({ data }) => {
    const { auth } = await import("@/lib/auth");
    const { getRequestHeaders } = await import("@tanstack/react-start/server");
    const headers = getRequestHeaders();
    const session = await auth.api.getSession({ headers });
    if (!session) throw new Error("Unauthorized");
    await db.delete(invites)
      .where(eq(invites.id, data.inviteId));
    return { success: true };
  });

export const cleanDuplicateInvites = createServerFn({ method: "POST" })
  .validator((workspaceId: string) => workspaceId)
  .handler(async ({ data: workspaceId }) => {
    const { auth } = await import("@/lib/auth");
    const { getRequestHeaders } = await import("@tanstack/react-start/server");
    const headers = getRequestHeaders();
    const session = await auth.api.getSession({ headers });
    if (!session) throw new Error("Unauthorized");
    const allInvites = await db.select()
      .from(invites)
      .where(
        and(
          eq(invites.workspaceId, workspaceId),
          isNull(invites.usedAt)
        )
      );

    const seen = new Map<string, string>();
    const toDelete: Array<string> = [];

    for (const invite of allInvites) {
      if (seen.has(invite.email)) {
        toDelete.push(invite.id);
      } else {
        seen.set(invite.email, invite.id);
      }
    }

    if (toDelete.length > 0) {
      for (const id of toDelete) {
        await db.delete(invites)
          .where(eq(invites.id, id));
      }
    }

    return {
      success: true,
      deletedCount: toDelete.length
    };
  });

export const acceptInvite = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    // 1. Verify token
    const results = await db.select()
      .from(invites)
      .where(
        and(
          eq(invites.token, data.token),
          isNull(invites.usedAt),
          gt(invites.expiresAt, new Date())
        )
      )
      .limit(1);

    const invite = results[0];
    if (!invite) throw new Error("Invalid or expired invitation token");

    const { auth } = await import("@/lib/auth");
    const { getRequestHeaders } = await import("@tanstack/react-start/server");
    const headers = getRequestHeaders();
    const session = await auth.api.getSession({ headers });
    if (!session) throw new Error("Unauthorized");
    const userId = session.user.id;
    if (session.user.email !== invite.email) {
      throw new Error("This invitation was sent to a different email address");
    }

    // 2. Add to member table using Better Auth's official API
    // This ensures all internal state and side-effects are handled
    try {
      await auth.api.addMember({
        body: {
          organizationId: invite.workspaceId ?? "",
          userId: userId,
          role: (invite.role as any) || "member",
        }
      });
    } catch (err: any) {
      console.error("[ERROR] Better Auth addMember failed:", err);
      // If they are already a member, we can ignore the error
      if (!err.message?.includes("already a member")) {
        throw err;
      }
    }

    // 3. Mark token as used
    await db.update(invites)
      .set({ usedAt: new Date() })
      .where(eq(invites.token, data.token));

    return { success: true, workspaceId: invite.workspaceId };
  });

export const requestPasswordReset = createServerFn({ method: "POST" })
  .validator((email: string) => email)
  .handler(async ({ data: email }) => {
    const { auth } = await import("@/lib/auth");
    console.log(`[DEBUG] requestPasswordReset server function for ${email}`);

    // Check if the user exists in the database
    const userExists = await db.select({ id: user.id })
      .from(user)
      .where(eq(user.email, email))
      .limit(1);

    if (userExists.length === 0) {
      return { success: true };
    }

    try {
      // Use Better Auth's official server-side API
      // This correctly generates the token and triggers the sendResetPassword hook
      const res = await auth.api.requestPasswordReset({
        body: {
          email,
          redirectTo: `${APP_URL}/reset-password`,
        },
      });

      console.log(`[DEBUG] Better Auth requestPasswordReset result:`, res);
      return { success: true };
    } catch (err: any) {
      console.error(`[ERROR] Better Auth requestPasswordReset failed:`, err);
      throw err;
    }
  });

export const verifyInviteToken = createServerFn({ method: "GET" })
  .validator((token: string) => token)
  .handler(async ({ data: token }) => {
    const results = await db.select()
      .from(invites)
      .where(
        and(
          eq(invites.token, token),
          isNull(invites.usedAt),
          gt(invites.expiresAt, new Date())
        )
      )
      .limit(1);

    const invite = results[0];
    if (!invite) throw new Error("Invalid or expired invitation token");

    // Check if the user already exists in the database
    const userExistsResults = await db.select({ id: user.id })
      .from(user)
      .where(eq(user.email, invite.email))
      .limit(1);

    return {
      ...invite,
      userExists: userExistsResults.length > 0,
    };
  });

export const verifyResetToken = createServerFn({ method: "GET" })
  .validator((token: string) => token)
  .handler(async ({ data: token }) => {
    const results = await db.select()
      .from(verification)
      .where(
        and(
          eq(verification.value, token),
          gt(verification.expiresAt, new Date())
        )
      )
      .limit(1);

    const reset = results[0];
    if (!reset) throw new Error("Invalid or expired reset token");
    return reset;
  });

export const markTokenUsed = createServerFn({ method: "POST" })
  .validator((data: { token: string, type: 'invite' | 'reset' }) => data)
  .handler(async ({ data }) => {
    if (data.type === 'invite') {
      await db.update(invites)
        .set({ usedAt: new Date() })
        .where(eq(invites.token, data.token));
    } else {
      await db.update(passwordResets)
        .set({ usedAt: new Date() })
        .where(eq(passwordResets.token, data.token));
    }
    return { success: true };
  });

export const getInvitations = createServerFn({ method: "GET" })
  .validator((workspaceId: string) => workspaceId)
  .handler(async ({ data: workspaceId }) => {
    const { auth } = await import("@/lib/auth");
    const { getRequestHeaders } = await import("@tanstack/react-start/server");
    const headers = getRequestHeaders();
    const session = await auth.api.getSession({ headers });
    if (!session) throw new Error("Unauthorized");
    return await db.select()
      .from(invites)
      .where(
        and(
          eq(invites.workspaceId, workspaceId),
          isNull(invites.usedAt)
        )
      );
  });

export const getWorkspaceMembers = createServerFn({ method: "GET" })
  .validator((workspaceId: string) => workspaceId)
  .handler(async ({ data: workspaceId }) => {
    const { auth } = await import("@/lib/auth");
    const { getRequestHeaders } = await import("@tanstack/react-start/server");
    const headers = getRequestHeaders();
    const session = await auth.api.getSession({ headers });
    if (!session) throw new Error("Unauthorized");

    const members = await db.select({
      id: member.id,
      role: member.role,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image
      }
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, workspaceId));

    return members;
  });
