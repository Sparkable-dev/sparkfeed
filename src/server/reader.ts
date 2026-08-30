import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { readUrl } from "./services/reader"
import { resolveWorkspaceContext } from "./services/context"
import { principalFromWorkspaceContext } from "./ai/principal"
import { feedUrlSchema } from "@/lib/validation"

/**
 * Reading an external page, for the artifact panel.
 *
 * The same service the `read_url` tool uses, reached from the browser instead
 * of from the model — because opening a card the model already produced should
 * not cost another model turn. One implementation, two callers, and the SSRF
 * guard and demo gate live in the service where neither can skip them.
 *
 * `feedUrlSchema` normalises and rejects anything that is not http(s) before
 * the value gets near a fetch. It is named for feeds but is the app's general
 * "a URL a user typed" schema.
 */
export const readExternalUrl = createServerFn({ method: "POST" })
  .validator(z.object({ url: feedUrlSchema }))
  .handler(async ({ data }) => {
    const context = await resolveWorkspaceContext()
    // Reading a public page touches no workspace data, but the principal
    // carries the demo flag the service refuses on.
    return await readUrl(await principalFromWorkspaceContext(context), {
      url: data.url,
    })
  })
