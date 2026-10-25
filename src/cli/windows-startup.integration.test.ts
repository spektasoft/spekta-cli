import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { COMMANDS } from "./commands";

describe.skipIf(process.platform !== "win32")(
  "native Windows CLI startup",
  () => {
    it("loads the full command registry without loading Tree-sitter", () => {
      const require = createRequire(import.meta.url);

      expect(COMMANDS.read).toBeDefined();
      expect(COMMANDS.diagnostic).toBeDefined();
      expect(
        Object.keys(require.cache).some((key) =>
          key.includes("tree-sitter-language-pack"),
        ),
      ).toBe(false);
    });
  },
);
