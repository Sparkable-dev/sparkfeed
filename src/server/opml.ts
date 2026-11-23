import { createServerFn, createServerOnlyFn } from "@tanstack/react-start"
import { and, eq } from "drizzle-orm"
import { z } from "zod"
import { assertWorkspaceWritable } from "./entitlements/browser-write"
import { resolveWorkspaceContext } from "./services/context"
import { OpmlDocumentError } from "./services/opml-document"
import {
  exportOpmlSubscriptions,
  importOpmlSubscriptions,
  previewOpmlSubscriptions,
} from "./services/opml-workspace"
import { db } from "@/db/index"
import { member } from "@/db/schema"
import { MAX_OPML_BYTES } from "@/lib/opml"

const workspaceId = z.string().min(1)
const importFile = z.object({
  workspaceId,
  xml: z.string().max(MAX_OPML_BYTES),
})
const destination = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("preserve") }),
  z.object({ kind: z.literal("new"), name: z.string().min(1) }),
  z.object({ kind: z.literal("existing"), folderId: z.string().min(1) }),
])

const checkImportWorkspace = createServerOnlyFn(async (expectedId: string) => {
  const context = await resolveWorkspaceContext({ allowSuspended: true })
  if (context.demo)
    throw new OpmlDocumentError("Adding sources is locked in demo mode.")
  if (!context.userId || context.workspaceId !== expectedId)
    throw new OpmlDocumentError(
      "Switch back to the workspace you want to import into."
    )

  await assertWorkspaceWritable(context)
  return context.workspaceId
})

export const previewOpml = createServerFn({ method: "POST" })
  .validator(importFile)
  .handler(async ({ data }) => {
    try {
      const id = await checkImportWorkspace(data.workspaceId)
      return {
        status: "ok" as const,
        ...(await previewOpmlSubscriptions(id, data.xml)),
      }
    } catch (error) {
      if (error instanceof OpmlDocumentError)
        return { status: "error" as const, message: error.message }
      throw error
    }
  })

export const importOpml = createServerFn({ method: "POST" })
  .validator(importFile.extend({ destination }))
  .handler(async ({ data }) => {
    try {
      const id = await checkImportWorkspace(data.workspaceId)
      return {
        status: "ok" as const,
        ...(await importOpmlSubscriptions(id, data.xml, data.destination)),
      }
    } catch (error) {
      if (error instanceof OpmlDocumentError)
        return { status: "error" as const, message: error.message }
      throw error
    }
  })

export const exportOpml = createServerFn({ method: "POST" })
  .validator(z.object({ workspaceId, folderId: z.string().min(1).optional() }))
  .handler(async ({ data }) => {
    const context = await resolveWorkspaceContext()
    if (!context.userId || context.workspaceId !== data.workspaceId)
      return {
        status: "error" as const,
        message: "Switch back to the workspace you want to export.",
      }

    if (context.workspace?.type === "organization") {
      const [membership] = await db
        .select({ id: member.id })
        .from(member)
        .where(
          and(
            eq(member.organizationId, context.workspaceId),
            eq(member.userId, context.userId)
          )
        )
        .limit(1)
      if (!membership)
        return {
          status: "error" as const,
          message: "Workspace membership is required.",
        }
    }

    const exported = await exportOpmlSubscriptions(
      context.workspaceId,
      data.folderId
    )
    if (!exported)
      return {
        status: "error" as const,
        message: data.folderId
          ? "That folder is no longer available."
          : "This workspace has no RSS subscriptions or folders to export.",
      }
    return { status: "ok" as const, ...exported }
  })
