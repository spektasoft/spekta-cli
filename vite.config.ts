import { defineConfig } from "vitest/config";
import { builtinModules } from "module";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: "index",
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
    viteStaticCopy({
      targets: [
        {
          src: "templates/*",
          dest: ".",
        },
      ],
    }),
  ],
  test: {
    include: ["src/**/*.test.ts"],
  },
});
