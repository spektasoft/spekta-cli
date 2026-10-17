import { describe, expect, it } from "vitest";
import type { HelpProcessHarness } from "./help-process-harness";

export function registerHelpProcessSafetyTests(harness: HelpProcessHarness) {
  const invoke = (...args: Parameters<HelpProcessHarness["invoke"]>) =>
    harness.invoke(...args);
  describe("help errors, seeded state, and read policy", () => {
    it.each([
      ["setup", "--global", "--codex", "--apply", "--mcp", "--help"],
      ["uninstall", "--global", "--codex", "--apply", "-h"],
      ["commit", "--commit", "--model", "missing-model", "--help"],
      ["prompt", "--output", "must-not-be-written.md", "--help"],
      ["mcp", "--help"],
    ])("preserves seeded configuration for %j", async (...args) => {
      const result = await invoke(args, true);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain(`Usage: spekta ${args[0]}`);
    });

    it("rejects explicit unknown topics without bootstrap or proxy execution", async () => {
      for (const args of [
        ["help", "unknown-tool"],
        ["unknown-tool", "--help"],
        ["help", "git", "push"],
        ["git", "push", "-h"],
        ["help", "read", "extra"],
      ]) {
        const result = await invoke(args);
        expect(result.exitCode).toBe(1);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain("Unknown help topic");
        expect(result.stderr).toContain("spekta --help");
        expect(result.stderr).not.toMatch(
          /Critical Error|Execution refused|ENOENT/,
        );
      }
    }, 15000);

    it("explains read operands, ranges, saving, budgets and policy", async () => {
      const result = await invoke(["read", "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      for (const text of [
        "Usage: spekta read",
        "[start,end]",
        "--save",
        "SPEKTA_EDITOR",
        "SPEKTA_READ_TOKEN_LIMIT",
        "1000",
        "--allowance",
        "--expected-version",
        "expectedVersion",
        "Version marker",
        "version_mismatch",
        "restart",
        "SPEKTA_READ_TOKEN_CEILING",
        "8000",
        "ceiling",
        "not a security boundary",
        "SPEKTA_COMPACT_THRESHOLD",
        "500",
        "response budget",
        "incomplete",
        "10 MB",
        ".env",
        ".gitignore",
        ".spektaignore",
        "symlink",
        "interactive",
        "Examples:",
        "spekta read 'src/index.ts[10,20]'",
        "./--help",
      ])
        expect(result.stdout).toContain(text);
    });
  });
}
