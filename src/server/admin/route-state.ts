import { createServerFn } from "@tanstack/react-start"
import { getRequestHeaders } from "@tanstack/react-start/server"
import { platformAdminIsExposed, readPlatformAdminSessionState } from "./access"

export const getPlatformAdminRouteState = createServerFn({
  method: "GET",
}).handler(async () => {
  if (!platformAdminIsExposed()) return { state: "not_found" as const }
  const origin =
    process.env.SPARKFEED_ADMIN_ORIGIN || "https://admin.sparkfeed.dev"
  return readPlatformAdminSessionState(
    new Request(`${origin}/admin`, { headers: getRequestHeaders() })
  )
})

export const getIsPlatformAdminSurface = createServerFn({
  method: "GET",
}).handler(() => platformAdminIsExposed())
