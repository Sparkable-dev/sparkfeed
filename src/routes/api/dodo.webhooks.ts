import { createFileRoute } from "@tanstack/react-router"
import { dodoClient } from "@/server/billing/dodo-client"
import {
  ingestVerifiedDodoWebhook,
  unwrapDodoWebhook,
} from "@/server/billing/personal-webhooks"
import { readSparkfeedDeploymentConfig } from "@/server/entitlements/config"

export const Route = createFileRoute("/api/dodo/webhooks")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const deployment = readSparkfeedDeploymentConfig()
        if (deployment.edition !== "cloud") {
          return new Response(null, { status: 404 })
        }
        try {
          const rawBody = await request.text()
          const { webhookId, event } = unwrapDodoWebhook(
            dodoClient(),
            rawBody,
            request.headers
          )
          const result = await ingestVerifiedDodoWebhook({
            webhookId,
            rawBody,
            event,
          })
          return Response.json({ received: true, duplicate: result.duplicate })
        } catch (error) {
          console.error(
            "[billing] Dodo webhook rejected:",
            error instanceof Error ? error.message : "unknown error"
          )
          return Response.json({ received: false }, { status: 400 })
        }
      },
    },
  },
})
