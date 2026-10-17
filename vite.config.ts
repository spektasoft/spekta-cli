import { defineConfig } from "vitest/config";
import { builtinModules } from "module";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { fileURLToPath } from "node:url";
import { buildMetadataPlugin } from "./src/build-metadata.ts";

export default defineConfig({
  build: {
    lib: {
      entry: { index: "src/index.ts", "codex-hook": "src/codex-hook.ts" },
      formats: ["es"],
      fileName: (format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: [...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
      output: {
        banner: "#!/usr/bin/env node",
      },
    },
    target: "node20",
    ssr: true,
  },
  plugins: [
    buildMetadataPlugin(fileURLToPath(new URL(".", import.meta.url))),
    viteStaticCopy({
      targets: [
        {
          src: "templates/**/*",
          dest: ".",
        },
      ],
      environment: "ssr",
    }),
  ],
  test: {
    include: ["src/**/*.test.ts"],
  },
});
