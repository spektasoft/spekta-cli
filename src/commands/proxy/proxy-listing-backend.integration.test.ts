import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchCommand } from "../../cli/commands";
import { createToolRegistry } from "../../api/mcp-server/registry";
import { getTokenCount } from "../../utils/read-utils";

/**
 * Focused native Windows backend verification through the public CLI and MCP
 * boundaries with real drive-letter temporary fixtures. Linux/WSL keeps the
 * RTK/GNU backend, so this suite runs only on native Windows.
 */

let root: string;
let workspace: string;
let savedCwd: string;
let savedExitCode: typeof process.exitCode;
const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

describe.skipIf(process.platform !== "win32")(
  "native Windows listing and discovery",
  () => {
    beforeEach(async () => {
      savedCwd = process.cwd();
      savedExitCode = process.exitCode;
      process.exitCode = undefined;
      root = await fs.mkdtemp(path.join(os.tmpdir(), "spekta-native-win-"));
      // The workspace sits under ancestors containing spaces on a drive-letter
      // root, per the native Windows path requirements.
      workspace = path.join(root, "spaces root", "workspace");
      await fs.ensureDir(workspace);
      process.chdir(workspace);
      vi.stubEnv("SPEKTA_HOME_OVERRIDE", path.join(root, "home"));
      vi.stubEnv("SPEKTA_ASSET_ROOT_OVERRIDE", repository);
      vi.stubEnv("SPEKTA_LIST_TOKEN_LIMIT", "1000");
      vi.stubEnv("SPEKTA_LIST_TOKEN_CEILING", "8000");
    });

    afterEach(async () => {
      process.chdir(savedCwd);
      process.exitCode = savedExitCode;
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      await fs.remove(root);
    });

    function bodyFromCli(text: string): string | null {
      const match = text.match(/```\n([\s\S]*?)\n```/);
      return match ? match[1] : null;
    }

    async function invoke(
      transport: "cli" | "mcp",
      command: "ls" | "find",
      args: string[],
    ): Promise<{ text: string; failed: boolean }> {
      process.exitCode = undefined;
      if (transport === "cli") {
        let output = "";
        let errorOutput = "";
        const logSpy = vi
          .spyOn(console, "log")
          .mockImplementation((...items) => {
            output += `${items.join(" ")}\n`;
          });
        const errorSpy = vi
          .spyOn(console, "error")
          .mockImplementation((...items) => {
            errorOutput += `${items.join(" ")}\n`;
          });
        try {
          await dispatchCommand(command, args);
          return {
            text: output ? (bodyFromCli(output) ?? output) : errorOutput,
            failed: process.exitCode === 1,
          };
        } finally {
          logSpy.mockRestore();
          errorSpy.mockRestore();
        }
      }
      const request: Record<string, unknown> = { command, args };
      const result = await createToolRegistry({
        root: workspace,
      }).spekta_shell.handler(request);
      return {
        text: result.content
          .map((block) => ("text" in block ? block.text : ""))
          .join("\n"),
        failed: result.isError === true,
      };
    }

    async function buildStandardFixture(): Promise<void> {
      const outside = path.join(root, "outside space");
      await fs.ensureDir(outside);
      await fs.writeFile(path.join(outside, "outside-secret.txt"), "external");
      await fs.ensureDir(path.join(workspace, "space sub"));
      await fs.writeFile(path.join(workspace, "root file.txt"), "root");
      await fs.writeFile(
        path.join(workspace, "space sub", "green file.txt"),
        "green",
      );
      await fs.writeFile(
        path.join(workspace, "secret.txt"),
        "ignored replacement content",
      );
      await fs.writeFile(
        path.join(workspace, ".spektaignore"),
        "secret.txt\nignored dir/\n",
      );
      await fs.ensureDir(path.join(workspace, "ignored dir"));
      await fs.writeFile(
        path.join(workspace, "ignored dir", "inner.txt"),
        "inner",
      );
      fs.symlinkSync(
        outside,
        path.join(workspace, "escape"),
        process.platform === "win32" ? "junction" : "dir",
      );
    }

    const disclosed = (value: string): string =>
      JSON.stringify(value).replace(/`/g, "\\u0060");

    it("lists drive-letter spaced workspaces through CLI and MCP", async () => {
      await buildStandardFixture();

      for (const transport of ["cli", "mcp"] as const) {
        const listing = await invoke(transport, "ls", ["."]);
        expect(listing.failed).toBe(false);
        expect(listing.text).toContain("Batch: success");
        expect(listing.text).toContain("Operand 1: returned; \".\"");
        // Backslash-style relative operands are equivalent on this host.
        const nested = await invoke(transport, "ls", ["space sub"]);
        expect(nested.text).toContain("Batch: success");
        expect(nested.text).toContain(disclosed("green file.txt"));

        const combined = await invoke(transport, "ls", [
          "space sub",
          "ignored dir",
          "missing sub dir",
        ]);
        expect(combined.failed).toBe(true);
        expect(combined.text).toContain("Batch: partial_result");
        expect(combined.text).toContain(
          'Operand 1: returned; "space sub"\n"green file.txt"\n',
        );
        expect(combined.text).toContain(
          "Operand 2: unavailable; unavailable_access",
        );
        expect(combined.text).toContain(
          "Operand 3: unavailable; unavailable_access",
        );
      }
    });

    it("applies ignore, restricted-file, and containment disclosure", async () => {
      await buildStandardFixture();

      for (const transport of ["cli", "mcp"] as const) {
        const listing = await invoke(transport, "ls", ["."]);
        expect(listing.failed).toBe(false);
        expect(listing.text).toContain(disclosed("root file.txt"));
        expect(listing.text).toContain(disclosed("space sub"));
        // Ignore rule, restricted file, and outside-junction containment:
        expect(listing.text).not.toContain("secret.txt");
        expect(listing.text).not.toContain("ignored dir");
        expect(listing.text).not.toContain("escape");
        expect(listing.text).not.toContain("outside-secret");

        const discovery = await invoke(transport, "find", [
          ".",
          "-type",
          "f",
          "-name",
          "*.txt",
        ]);
        expect(discovery.failed).toBe(false);
        expect(discovery.text).toContain("Batch: success");
        expect(discovery.text).toContain(disclosed("root file.txt"));
        expect(discovery.text).toContain(
          disclosed("space sub/green file.txt"),
        );
        expect(discovery.text).not.toContain("escape/");
        expect(discovery.text).not.toContain("outside-secret");
        // The junction itself is never disclosed even unfiltered.
        const everything = await invoke(transport, "find", ["."]);
        expect(everything.text).not.toContain("escape");
        expect(everything.text).not.toContain("outside-secret");
        expect(everything.text).toContain('"."');
        expect(everything.text).toContain(disclosed("space sub"));
      }
    });

    it("keeps contained directory links physical on link roots", async () => {
      await buildStandardFixture();
      // endpoint: expose a contained link and confirm the root stays physical.
      const containedAlias = path.join(workspace, "internal-alias");
      fs.symlinkSync(
        path.join(workspace, "space sub"),
        containedAlias,
        process.platform === "win32" ? "junction" : "dir",
      );

      for (const transport of ["cli", "mcp"] as const) {
        const through = await invoke(transport, "find", [
          "internal-alias",
          "-type",
          "f",
        ]);
        // Link roots are printed but never traversed, so no descendants.
        expect(through.text).toContain("Batch: success");
        expect(through.text).toContain("No eligible paths in this discovery.");
        expect(through.text).not.toContain("green file.txt");
      }
    });

    it("bounds large listings and preserves whole entry names", async () => {
      await fs.ensureDir(path.join(workspace, "big"));
      const total = 260;
      for (let index = 0; index < total; index++) {
        const name = `space filler entry ${String(index).padStart(3, "0")} padding 0123456789 0123456789.txt`;
        await fs.writeFile(path.join(workspace, "big", name), "x");
      }
      for (const transport of ["cli", "mcp"] as const) {
        const listing = await invoke(transport, "ls", ["big"]);
        expect(listing.failed).toBe(true);
        expect(listing.text).toContain("Batch: partial_result");
        expect(listing.text).toContain(
          "Operand 1: incomplete; output_limit_exceeded",
        );
        expect(listing.text).toContain("Listing incomplete.");
        expect(getTokenCount(listing.text)).toBeLessThanOrEqual(1000);
        const returned = listing.text
          .split("\n")
          .filter((line) => line.startsWith('"space filler entry'));
        expect(returned.length).toBeGreaterThan(0);
        expect(returned.length).toBeLessThan(total);
        for (const line of returned) {
          const name = JSON.parse(line) as string;
          expect(name.endsWith(".txt")).toBe(true);
        }
        // Returned entries keep the backend's name (code point) order.
        const parsed = returned.map((line) => JSON.parse(line) as string);
        const sorted = [...parsed].sort();
        expect(parsed).toEqual(sorted);
      }
    }, 60_000);
  },
);

