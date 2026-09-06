import { definePlugin } from "nitro"

export default definePlugin((app) => {
  if (
    process.env.SPARKFEED_EDITION !== "cloud" ||
    process.env.SPARKFEED_ALLOWANCE_WORKER === "false"
  )
    return
  let running = false
  const timer = setInterval(
    async () => {
      if (running) return
      running = true
      try {
        const { refreshWorkspaceAllowances } =
          await import("../entitlements/maintenance")
        await refreshWorkspaceAllowances()
      } catch (error) {
        console.error(
          "[allowance-maintenance] Refresh failed",
          error instanceof Error ? error.message : "Unknown error"
        )
      } finally {
        running = false
      }
    },
    15 * 60 * 1000
  )
  timer.unref()
  app.hooks.hook("close", () => {
    clearInterval(timer)
  })
})
