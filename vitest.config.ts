import { defineConfig } from "vitest/config"
import viteTsConfigPaths from "vite-tsconfig-paths"

/**
 * Tests get their own config on purpose. Reusing vite.config.ts pulls in the
 * TanStack Start and Nitro plugins, which start a dev server that never shuts
 * down, so `bun run test` hangs after the run finishes.
 */
export default defineConfig({
  plugins: [viteTsConfigPaths({ projects: ["./tsconfig.json"] })],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
})
