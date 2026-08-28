// Nitro 3 exports this from the package root, not from `nitro/app`. (The old
// `declare const defineNitroPlugin` in the sibling plugins is a Nitro 2 /
// auto-import idiom that never worked here, which went unnoticed because none
// of those plugins were ever registered.)
import { definePlugin } from 'nitro'

/**
 * Seeds the demo workspace at boot.
 *
 * Seeding is otherwise lazy, triggered only by `getAllData` when a page loads.
 * That is fine for a browser but not for MCP: an agent connecting to a cold
 * demo container would either see an empty workspace or wait through a
 * 30-90 second seed (nine feeds, plus an og:image fetch per item) and time out
 * its `initialize` call.
 *
 * Demo only. In production this returns immediately and the database is
 * migrated by `bun run db:migrate`, deliberately not on boot.
 */
export default definePlugin(() => {
  // Checked on both: import.meta.env is inlined by Vite for the app bundle, but
  // Nitro plugins are bundled by rollup where it may be undefined.
  const isDemo =
    import.meta.env?.VITE_DEMO_MODE === 'true' || process.env.VITE_DEMO_MODE === 'true'
  if (!isDemo) return

  // Not awaited: the server must start listening immediately. Requests that
  // arrive mid-seed see a partially-populated workspace, which is better than a
  // container that fails its health check while fetching feeds.
  void (async () => {
    try {
      console.log('[demo-boot] Preparing demo workspace…')
      const { ensureDemoSchema, seedDemoData } = await import('../demo-seeder')
      await ensureDemoSchema()
      await seedDemoData()
      console.log('[demo-boot] Demo workspace ready.')
    } catch (err) {
      // Never fatal: a failed seed leaves an empty demo, not a dead service.
      console.error('[demo-boot] Seeding failed:', err)
    }
  })()
})
