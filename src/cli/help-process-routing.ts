import { describe, expect, it } from "vitest";
import type { HelpProcessHarness } from "./help-process-harness";
import fs from "fs-extra";
import path from "node:path";

export function registerHelpProcessRoutingTests(harness: HelpProcessHarness) {
  const invoke = (...args: Parameters<HelpProcessHarness["invoke"]>) =>
    harness.invoke(...args);
  describe("help routing and operands", () => {
    it.each([
      ["./--help", "literal-help-file"],
      ["./-h", "literal-short-help-file"],
    ])("reads the literal help-looking path %s", async (file, content) => {
      const result = await invoke(["read", file], false, true);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain(content);
      expect(result.stdout).not.toContain("Usage:");
    });

    it.each([
      ["write", "new.ts", "--help"],
      ["replace", "existing.ts", "-h"],
      ["commit", "--model", "--help"],
      ["prompt", "--output", "--help"],
      ["prompt", "--include-partial", "--help"],
      ["prompt", "--exclude-partial", "--help"],
      ["grep", "--help", "existing.ts"],
      ["grep", "pattern", "--glob", "-h"],
      ["find", ".", "-name", "--help"],
      ["find", ".", "-type", "-h"],
      ["git", "log", "-n", "-h"],
      ["git", "status", "--", "--help"],
      ["read", "--", "--help"],
    ])("preserves help-looking data and values in %j", async (...args) => {
      const result = await invoke(args, false, true);
      expect(result.exitCode).toBe(1);
      expect(result.stdout + result.stderr).not.toBe("");
      expect(result.stdout).not.toContain("Usage: spekta");
      expect(result.stderr).not.toContain("Unknown help topic");
      expect(result.stderr).not.toContain("Critical Error");
    });

    it.each([
      ["grep", "needle"],
      ["grep", "--help"],
      ["help", "grep"],
    ])(
      "rejects removed grep entry points with migration guidance for %j",
      async (...args) => {
        const result = await invoke(args);
        expect(result.exitCode).toBe(1);
        expect(result.stdout + result.stderr).toContain("spekta rg");
        expect(result.stdout + result.stderr).not.toContain("grep — Search");
        expect(
          await fs.pathExists(
            path.join(harness.tempRoot, "backend-invocations.txt"),
          ),
        ).toBe(false);
      },
    );

    it.each(["-h", "help"])("supports the global %s alias", async (alias) => {
      const result = await invoke([alias]);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Built-in commands:");
      expect(result.stdout).toContain("Supported proxy families:");
    });

    it.each([
      ["read", "-h"],
      ["help", "read"],
      ["read", "--help", "--save"],
      ["read", "existing.ts[1,5]", "--save", "--help"],
    ])("supports read help via %j", async (...args) => {
      const result = await invoke(args, true);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("read — Read eligible workspace files");
      expect(result.stdout).toContain("Examples:");
    });

    it.each([
      ["rg", "-h", "rg —"],
      ["help", "rg", "rg —"],
      ["git", "status", "--help", "git status —"],
      ["help", "git", "status", "git status —"],
    ])("supports help alias via %j", async (...args) => {
      const expectedTitle = args.pop() as string;
      const result = await invoke(args);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain(expectedTitle);
    });
  });
}
