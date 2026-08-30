import { createFileRoute } from "@tanstack/react-router"
import { ZodError } from "zod"
import {
  PlatformAdminHttpError,
  assertPlatformAdminSurface,
  assertSameOrigin,
  enforceAdminMutationRateLimit,
  readPlatformAdminSessionState,
  requirePlatformAdmin,
} from "@/server/admin/access"
import {
  executeAdminMutation,
  getPlatformUser,
  getPlatformWorkspace,
  listAdminAudit,
  listPlatformUsers,
  listPlatformWorkspaces,
  listWebhookFailures,
} from "@/server/admin/operations"

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  })
}

function parts(request: Request): Array<string> {
  return new URL(request.url).pathname
    .replace(/^\/api\/platform-admin\/?/, "")
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent)
}

async function serveGet(request: Request): Promise<Response> {
  assertPlatformAdminSurface()
  const path = parts(request)
  if (path[0] === "bootstrap") {
    return json(await readPlatformAdminSessionState(request))
  }

  await requirePlatformAdmin(request)
  const query = new URL(request.url).searchParams.get("q") || ""
  if (path[0] === "users" && path[1]) {
    const detail = await getPlatformUser(path[1])
    return detail ? json(detail) : json({ error: "User not found." }, 404)
  }
  if (path[0] === "users")
    return json({ users: await listPlatformUsers(query) })
  if (path[0] === "workspaces" && path[1] && path[2]) {
    if (path[1] !== "personal" && path[1] !== "organization") {
      return json({ error: "Workspace not found." }, 404)
    }
    const detail = await getPlatformWorkspace(path[1], path[2])
    return detail ? json(detail) : json({ error: "Workspace not found." }, 404)
  }
  if (path[0] === "workspaces") {
    return json({ workspaces: await listPlatformWorkspaces(query) })
  }
  if (path[0] === "webhooks")
    return json({ webhooks: await listWebhookFailures() })
  if (path[0] === "audit") return json({ audit: await listAdminAudit() })
  return json({ error: "Not found." }, 404)
}

async function servePost(request: Request): Promise<Response> {
  assertPlatformAdminSurface()
  assertSameOrigin(request)
  const actor = await requirePlatformAdmin(request)
  enforceAdminMutationRateLimit(actor.userId)
  if (parts(request)[0] !== "mutations")
    return json({ error: "Not found." }, 404)
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: "Request body must be JSON." }, 400)
  }
  return json({ result: await executeAdminMutation(request, actor, body) })
}

async function handle(request: Request): Promise<Response> {
  try {
    if (request.method === "GET") return await serveGet(request)
    if (request.method === "POST") return await servePost(request)
    return json({ error: "Method not allowed." }, 405)
  } catch (error) {
    if (error instanceof PlatformAdminHttpError) {
      return json({ error: error.message }, error.status)
    }
    if (error instanceof ZodError) {
      return json(
        { error: "Invalid admin request.", issues: error.issues },
        400
      )
    }
    console.error("[platform-admin] request failed", error)
    return json(
      {
        error: error instanceof Error ? error.message : "Admin request failed.",
      },
      500
    )
  }
}

export const Route = createFileRoute("/api/platform-admin/$")({
  server: {
    handlers: {
      GET: ({ request }: { request: Request }) => handle(request),
      POST: ({ request }: { request: Request }) => handle(request),
    },
  },
})
