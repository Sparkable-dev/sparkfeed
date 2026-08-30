import { defineConfig } from "vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import { nitro } from "nitro/vite"
import viteReact from "@vitejs/plugin-react"
import viteTsConfigPaths from "vite-tsconfig-paths"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  plugins: [
    viteTsConfigPaths({
      projects: ["./tsconfig.json"],
    }),
    tailwindcss(),
    tanstackStart(),
    // Nitro produces a deployable Node server at .output/server/index.mjs
    // (run with `node .output/server/index.mjs`). Without it the build only
    // emits a request handler that does not listen on a port.
    //
    // `plugins` must be listed explicitly. Nitro only auto-registers a
    // `plugins/` directory inside its own scanDirs, which this project does not
    // configure, so for a long time src/server/plugins/* was dead code that
    // never ran: the built server contained none of it. Anything added there
    // needs a line here or it silently does nothing.
    nitro({
      plugins: [
        "src/server/plugins/deployment-config.ts",
        "src/server/plugins/demo-boot.ts",
      ],
    }),
    viteReact(),
  ],
  optimizeDeps: {
    include: ["@noble/ciphers"],
  },
})
