// Nitro 3 exports this from the package root, not from `nitro/app`. (The old
// `declare const defineNitroPlugin` in the sibling plugins is a Nitro 2 /
// auto-import idiom that never worked here, which went unnoticed because none
// of those plugins were ever registered.)
import { definePlugin } from "nitro"

/** Initialize and refresh the SQLite demo without delaying server startup. */
export default definePlugin((app) => {
  const isDemo =
    import.meta.env?.VITE_DEMO_MODE === "true" ||
    process.env.VITE_DEMO_MODE === "true"
  if (!isDemo) return

  let running = false
  let closed = false
  const check = async () => {
    if (running || closed) return
    running = true
    try {
      const { ensureDemoSchema, seedDemoData } = await import("../demo-seeder")
      const { refreshDemoFeeds } = await import("../demo-refresh")
      await ensureDemoSchema()
      await seedDemoData()
      if (!closed) await refreshDemoFeeds()
    } catch (error) {
      console.error("[demo-refresh] Check failed:", error)
    } finally {
      running = false
    }
  }
  // Hourly checks only read the schedule until the daily refresh is due.
  const timer = setInterval(() => {
    void check()
  }, 60 * 60_000)
  timer.unref()
  app.hooks.hook("close", () => {
    closed = true
    clearInterval(timer)
  })
  void check()
})
