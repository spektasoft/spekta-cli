import { defineConfig } from "vitest/config";
import { builtinModules } from "module";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { fileURLToPath } from "node:url";
import { buildMetadataPlugin } from "./src/build-metadata.ts";

// Native Windows does not provide Tree-sitter; those suites run in Linux/WSL.
const windowsParserTestExcludes =
  process.platform === "win32"
    ? [
        "src/utils/compactor.test.ts",
        "src/utils/compactor/compactor.compatibility.test.ts",
        "src/utils/compactor/engine.compactable-tier.test.ts",
        "src/utils/compactor/engine.test.ts",
        "src/utils/compactor/function-regions.test.ts",
        "src/utils/compactor/index.test.ts",
        "src/utils/compactor/parser.test.ts",
        "src/utils/compactor/test-regions.test.ts",
      ]
    : [];

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
    target: "node22",
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
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/cypress/**",
      "**/.{idea,git,cache,output,temp}/**",
      ...windowsParserTestExcludes,
    ],
  },
});
